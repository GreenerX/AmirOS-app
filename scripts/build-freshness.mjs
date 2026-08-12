import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";

const BUILD_STAMP_VERSION = 1;
const ARTIFACTS = {
  backend: {
    label: "backend",
    output: "dist/src/server.js",
    stamp: "dist/.amiros-backend-build.json",
  },
  ui: {
    label: "dashboard UI",
    output: "ui/dist/index.html",
    stamp: "ui/dist/.amiros-ui-build.json",
  },
};

export class BuildFreshnessError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "BuildFreshnessError";
  }
}

function sourceFilesIn(directory, include = () => true) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFilesIn(path, include));
    else if (entry.isFile() && include(path)) files.push(path);
  }
  return files;
}

function artifactDefinition(kind) {
  const definition = ARTIFACTS[kind];
  if (!definition) throw new BuildFreshnessError(`Unknown build artifact: ${kind}`);
  return definition;
}

export function buildPaths(projectDirectory, kind) {
  const definition = artifactDefinition(kind);
  return {
    outputPath: resolve(projectDirectory, definition.output),
    stampPath: resolve(projectDirectory, definition.stamp),
  };
}

export function artifactSourceFiles(projectDirectory, kind) {
  const sharedInputs = [resolve(projectDirectory, "package.json"), resolve(projectDirectory, "pnpm-lock.yaml")];
  const inputs = kind === "backend" ? [
    ...sharedInputs,
    resolve(projectDirectory, "tsconfig.json"),
    ...sourceFilesIn(resolve(projectDirectory, "src"), (path) => path.endsWith(".ts")),
    ...sourceFilesIn(resolve(projectDirectory, "scripts"), (path) => path.endsWith(".ts")),
  ] : kind === "ui" ? [
    ...sharedInputs,
    resolve(projectDirectory, "ui/index.html"),
    resolve(projectDirectory, "ui/tsconfig.json"),
    resolve(projectDirectory, "ui/vite.config.ts"),
    ...sourceFilesIn(resolve(projectDirectory, "ui/src")),
  ] : [];
  artifactDefinition(kind);
  return inputs.filter(existsSync).sort();
}

export function artifactSourceHash(projectDirectory, kind) {
  const inputs = artifactSourceFiles(projectDirectory, kind);
  const hash = createHash("sha256");
  for (const path of inputs) {
    hash.update(relative(projectDirectory, path));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function readBuildStamp(stampPath) {
  if (!existsSync(stampPath)) return undefined;
  try {
    const value = JSON.parse(readFileSync(stampPath, "utf8"));
    if (value?.version !== BUILD_STAMP_VERSION || typeof value.sourceHash !== "string") return undefined;
    return value;
  } catch {
    return undefined;
  }
}

export function inspectBuild(projectDirectory, kind) {
  const definition = artifactDefinition(kind);
  const { outputPath, stampPath } = buildPaths(projectDirectory, kind);
  const sourceHash = artifactSourceHash(projectDirectory, kind);
  if (!existsSync(outputPath)) {
    return { fresh: false, reason: `${definition.label} build is missing`, sourceHash, outputPath, stampPath };
  }
  const stamp = readBuildStamp(stampPath);
  if (!stamp) {
    return { fresh: false, reason: `${definition.label} build stamp is missing or invalid`, sourceHash, outputPath, stampPath };
  }
  if (stamp.sourceHash !== sourceHash) {
    return { fresh: false, reason: `${definition.label} source has changed since it was built`, sourceHash, outputPath, stampPath };
  }
  return { fresh: true, reason: `${definition.label} build matches current source`, sourceHash, outputPath, stampPath };
}

export function writeBuildStamp(projectDirectory, kind, sourceHash = artifactSourceHash(projectDirectory, kind)) {
  const { stampPath } = buildPaths(projectDirectory, kind);
  mkdirSync(resolve(stampPath, ".."), { recursive: true });
  const temporaryPath = `${stampPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({
    version: BUILD_STAMP_VERSION,
    artifact: kind,
    sourceHash,
    builtAt: new Date().toISOString(),
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, stampPath);
}

export function compileBackend(projectDirectory) {
  const compilerPath = resolve(projectDirectory, "node_modules/typescript/bin/tsc");
  if (!existsSync(compilerPath)) {
    throw new BuildFreshnessError(
      "The backend is stale, but the TypeScript compiler is unavailable. Run pnpm install, then pnpm build.",
    );
  }
  const result = spawnSync(process.execPath, [compilerPath, "-p", "tsconfig.json"], {
    cwd: projectDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new BuildFreshnessError(
      `The backend is stale and its automatic rebuild failed. Fix the build errors, then run pnpm build.\n${details}`.trim(),
    );
  }
}

export function compileUi(projectDirectory) {
  const vitePath = resolve(projectDirectory, "node_modules/vite/bin/vite.js");
  if (!existsSync(vitePath)) {
    throw new BuildFreshnessError(
      "The dashboard UI is stale, but Vite is unavailable. Run pnpm install, then pnpm ui:build.",
    );
  }
  const result = spawnSync(process.execPath, [vitePath, "build", "--config", "ui/vite.config.ts"], {
    cwd: projectDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new BuildFreshnessError(
      `The dashboard UI is stale and its automatic rebuild failed. Fix the build errors, then run pnpm ui:build.\n${details}`.trim(),
    );
  }
}

export function buildArtifact(projectDirectory, kind, { compile = kind === "backend" ? compileBackend : compileUi } = {}) {
  const definition = artifactDefinition(kind);
  const sourceHashBeforeBuild = artifactSourceHash(projectDirectory, kind);
  compile(projectDirectory);
  const sourceHashAfterBuild = artifactSourceHash(projectDirectory, kind);
  if (sourceHashAfterBuild !== sourceHashBeforeBuild) {
    throw new BuildFreshnessError(
      `${definition.label} source changed while it was building. Run the build again before starting AmirOS.`,
    );
  }
  const { outputPath, stampPath } = buildPaths(projectDirectory, kind);
  if (!existsSync(outputPath)) {
    rmSync(stampPath, { force: true });
    throw new BuildFreshnessError(`The ${definition.label} build completed without creating ${definition.output}.`);
  }
  writeBuildStamp(projectDirectory, kind, sourceHashAfterBuild);
  return inspectBuild(projectDirectory, kind);
}

export function ensureFreshBuild(projectDirectory, kind, options = {}) {
  const definition = artifactDefinition(kind);
  const inspection = inspectBuild(projectDirectory, kind);
  if (inspection.fresh) return { ...inspection, rebuilt: false };
  options.log?.(`Build preflight detected that the ${inspection.reason}; rebuilding before launch.`);
  const rebuilt = buildArtifact(projectDirectory, kind, options);
  options.log?.(`Build preflight completed successfully; ${definition.label} build is current.`);
  return { ...rebuilt, rebuilt: true };
}

export const backendBuildPaths = (projectDirectory) => buildPaths(projectDirectory, "backend");
export const backendSourceHash = (projectDirectory) => artifactSourceHash(projectDirectory, "backend");
export const inspectBackendBuild = (projectDirectory) => inspectBuild(projectDirectory, "backend");
export const writeBackendBuildStamp = (projectDirectory, sourceHash) => writeBuildStamp(projectDirectory, "backend", sourceHash);
export const buildBackend = (projectDirectory, options) => buildArtifact(projectDirectory, "backend", options);
export const ensureFreshBackendBuild = (projectDirectory, options) => ensureFreshBuild(projectDirectory, "backend", options);
export const inspectUiBuild = (projectDirectory) => inspectBuild(projectDirectory, "ui");
export const writeUiBuildStamp = (projectDirectory, sourceHash) => writeBuildStamp(projectDirectory, "ui", sourceHash);
export const buildUi = (projectDirectory, options) => buildArtifact(projectDirectory, "ui", options);
export const ensureFreshUiBuild = (projectDirectory, options) => ensureFreshBuild(projectDirectory, "ui", options);

export function isBuildFreshnessError(error) {
  return error instanceof BuildFreshnessError;
}
