import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";

function sourceFilesIn(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesIn(path);
    return entry.isFile() ? [path] : [];
  });
}

export function currentUiSourceHash(projectRoot = resolve(".")): string {
  const inputs = [
    resolve(projectRoot, "package.json"),
    resolve(projectRoot, "pnpm-lock.yaml"),
    resolve(projectRoot, "ui/index.html"),
    resolve(projectRoot, "ui/tsconfig.json"),
    resolve(projectRoot, "ui/vite.config.ts"),
    ...sourceFilesIn(resolve(projectRoot, "ui/src")),
  ].filter(existsSync).sort();
  const hash = createHash("sha256");
  for (const path of inputs) {
    hash.update(relative(projectRoot, path));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function uiBuildFingerprint(root = resolve("ui/dist")): string | undefined {
  const stampPath = resolve(root, ".amiros-ui-build.json");
  if (!existsSync(stampPath)) return undefined;
  try {
    const value = JSON.parse(readFileSync(stampPath, "utf8")) as { sourceHash?: unknown };
    return typeof value.sourceHash === "string" && /^[a-f0-9]{64}$/u.test(value.sourceHash)
      ? value.sourceHash
      : undefined;
  } catch {
    return undefined;
  }
}

export function uiBuildIsCurrent(root = resolve("ui/dist"), projectRoot = resolve(".")): boolean {
  const fingerprint = uiBuildFingerprint(root);
  return Boolean(fingerprint && fingerprint === currentUiSourceHash(projectRoot));
}

export function uiAssetCacheControl(root: string, filePath: string): string {
  if (basename(filePath) === "index.html") return "no-cache, no-store, must-revalidate";
  const path = relative(root, filePath);
  const isHashedViteAsset = !path.startsWith(`..${sep}`)
    && path.split(sep)[0] === "assets"
    && /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/u.test(basename(filePath));
  return isHashedViteAsset
    ? "public, max-age=31536000, immutable"
    : "no-cache, must-revalidate";
}
