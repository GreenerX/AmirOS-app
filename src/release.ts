import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type ReleaseNote = {
  title: string;
  detail: string;
};

export type AmirOSRelease = {
  version: string;
  releasedAt: string;
  headline: string;
  notes: ReleaseNote[];
};

function packageVersion(): string {
  const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || !packageJson.version.trim()) {
    throw new Error("AmirOS needs a valid version in package.json");
  }
  return packageJson.version;
}

/**
 * The npm/package version is the single release identifier for the local app,
 * the dashboard API, and the Git tag created for a release.
 */
export const AMIROS_VERSION = packageVersion();

export const CURRENT_RELEASE: AmirOSRelease = {
  version: AMIROS_VERSION,
  releasedAt: "2026-08-04",
  headline: "A more reliable launch",
  notes: [
    {
      title: "Finder-friendly Node detection",
      detail: "Open AmirOS now finds Node in the common macOS locations that Finder normally leaves out of its PATH.",
    },
    {
      title: "A safer development fallback",
      detail: "On this development Mac, AmirOS can temporarily use Codex’s local Node runtime until Node is installed system-wide.",
    },
    {
      title: "Release notes, right in the app",
      detail: "Select the version button any time to see what changed. New notes still open automatically once after every update.",
    },
  ],
};
