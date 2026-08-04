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
  headline: "Start and stop with confidence",
  notes: [
    {
      title: "Reliable background stopping",
      detail: "Stop AmirOS can now safely find its own background service even if its small process record is missing.",
    },
    {
      title: "One simple way to stop",
      detail: "Double-click stop-whatsapp-bot.command whenever you want to stop AmirOS, then use Open AmirOS.command to start it again.",
    },
    {
      title: "Release notes, right in the app",
      detail: "Select the version button any time to see what changed. New notes still open automatically once after every update.",
    },
  ],
};
