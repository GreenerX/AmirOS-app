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
  headline: "A smoother first launch",
  notes: [
    {
      title: "Welcome to AmirOS",
      detail: "New installations now start with a guided setup for your AI key, WhatsApp connection, and dashboard.",
    },
    {
      title: "Release notes, right in the app",
      detail: "Select the version button any time to see what changed. New notes open automatically once after every update.",
    },
    {
      title: "A clearer path for testers",
      detail: "The version shown here matches the release version in Git, so support conversations can start with one useful detail.",
    },
  ],
};
