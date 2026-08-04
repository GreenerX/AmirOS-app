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
  releasedAt: "2026-08-05",
  headline: "A simpler, smarter first start",
  notes: [
    {
      title: "Set up everything in one place",
      detail: "New users can add their own OpenAI API key and link WhatsApp with a QR code without leaving the welcome guide.",
    },
    {
      title: "You choose what AmirOS learns",
      detail: "Pick whether new chats need approval, private chats are tracked automatically, or knowledge tracking stays off. AmirOS asks before it learns when you choose that option.",
    },
    {
      title: "Every update stays easy to follow",
      detail: "The What’s new window now keeps a simple history of past versions, so you can see what changed whenever you need to.",
    },
    {
      title: "A more dependable launch",
      detail: "AmirOS can clear an outdated background-service record before starting, helping it recover cleanly after an interrupted session.",
    },
  ],
};

/**
 * A short, human-readable record shown in the dashboard. Keep the current
 * release first, then add every published release below it when shipping.
 */
export const RELEASE_HISTORY: AmirOSRelease[] = [
  CURRENT_RELEASE,
  {
    version: "0.2.2",
    releasedAt: "2026-08-04",
    headline: "Start and stop with confidence",
    notes: [
      {
        title: "Reliable background stopping",
        detail: "Stop AmirOS can safely find its own background service even if its small process record is missing.",
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
  },
  {
    version: "0.2.1",
    releasedAt: "2026-08-04",
    headline: "A smoother way to open AmirOS",
    notes: [
      {
        title: "Opens more reliably",
        detail: "Open AmirOS is better at finding what it needs to start when you double-click it in Finder.",
      },
      {
        title: "Helpful updates in the app",
        detail: "You can see a simple summary of each update without reading technical details.",
      },
    ],
  },
  {
    version: "0.2.0",
    releasedAt: "2026-08-04",
    headline: "A guided first setup",
    notes: [
      {
        title: "A welcoming setup guide",
        detail: "New users are shown the key steps for connecting WhatsApp, choosing an AI budget, and getting started.",
      },
      {
        title: "Always know what changed",
        detail: "AmirOS started showing a clear “What’s new” window after an update.",
      },
    ],
  },
  {
    version: "0.1.0",
    releasedAt: "2026-08-03",
    headline: "The first AmirOS release",
    notes: [
      {
        title: "Your private WhatsApp co-pilot",
        detail: "The first release introduced the AmirOS dashboard, WhatsApp connection, and local relationship memory.",
      },
    ],
  },
];
