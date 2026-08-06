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
  releasedAt: "2026-08-06",
  headline: "A reliable published-release update",
  notes: [
    {
      title: "One-click updates can download the published version",
      detail: "Fixed an issue that could stop an update before it began. AmirOS now fetches the exact published version correctly, while leaving your current app and private data untouched if an update cannot start.",
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
    version: "0.6.4",
    releasedAt: "2026-08-06",
    headline: "Inbox polish, safer restarts, and release-based updates",
    notes: [
      {
        title: "Smoother, more faithful conversations",
        detail: "Inbox now keeps reactions, calls, new-message navigation, and message details more dependable, so it is easier to follow a live WhatsApp conversation.",
      },
      {
        title: "A safer way to recover AmirOS",
        detail: "Settings now includes a local backend restart control. AmirOS can reconnect the dashboard after a brief restart without touching your private data.",
      },
      {
        title: "Updates now follow published releases",
        detail: "AmirOS will only notify you when a finished GitHub release is published. Ordinary behind-the-scenes improvements are no longer shown as updates.",
      },
      {
        title: "A more balanced home screen",
        detail: "The Agenda stays visually consistent whether it has several plans and tasks or none yet, while Next best action opens the exact message that needs your attention.",
      },
    ],
  },
  {
    version: "0.6.3",
    releasedAt: "2026-08-06",
    headline: "Installer and recovery fixes",
    notes: [
      {
        title: "Clean installs now build everything they need",
        detail: "Installing AmirOS from a ZIP now creates both the dashboard and the background service before it opens, so a fresh install no longer depends on files left behind by an older version.",
      },
      {
        title: "Older installations upgrade safely",
        detail: "Updating from an older AmirOS folder now brings across your API key, WhatsApp link, settings, knowledge, calendar, tasks, profiles, and avatars while keeping your private data on your Mac.",
      },
      {
        title: "More dependable recovery",
        detail: "AmirOS prepares its runtime folders before it starts and checks clean installs, upgrades, dashboard availability, and recovery automatically before a release is shared.",
      },
    ],
  },
  {
    version: "0.6.2",
    releasedAt: "2026-08-06",
    headline: "A smoother, safer update experience",
    notes: [
      {
        title: "Faster, safer updates",
        detail: "AmirOS now keeps your WhatsApp link safely in place during an update instead of making a large extra copy of it. Updates finish much more reliably while your private data stays on your Mac.",
      },
    ],
  },
  {
    version: "0.6.1",
    releasedAt: "2026-08-05",
    headline: "A clearer, more reliable daily assistant",
    notes: [
      {
        title: "A to-do list that remembers",
        detail: "Checked-off tasks now stay in your list with a clear completion time. Active tasks remain at the top and completed tasks move below them, so you can always see what you got done.",
      },
      {
        title: "Your day, in one place",
        detail: "The Overview now brings upcoming plans and to-dos together in a cleaner agenda, with quick links to open the full calendar or task list.",
      },
      {
        title: "Smarter relationship knowledge",
        detail: "AmirOS is better at keeping useful conversation knowledge organised, while making it easier to review new suggestions before they are saved.",
      },
      {
        title: "More dependable conversations",
        detail: "Chats now handle long messages, mentions, and returning to a conversation more smoothly, helping you pick up where you left off.",
      },
      {
        title: "Updates from inside AmirOS",
        detail: "When a newer public version is available, AmirOS can let you know and start the private, backed-up update from the dashboard.",
      },
    ],
  },
  {
    version: "0.5.0",
    releasedAt: "2026-08-05",
    headline: "Updates that take care of themselves",
    notes: [
      {
        title: "One-click updates for testers",
        detail: "Double-click Update AmirOS to safely install the newest version. Your WhatsApp link, knowledge, calendar, settings, profile photos, and API key stay on your Mac.",
      },
      {
        title: "A backup before every update",
        detail: "AmirOS makes a private backup before an update, then restores your personal data automatically when it finishes.",
      },
      {
        title: "Stronger recovery after an interruption",
        detail: "If power or internet drops, AmirOS checks its WhatsApp connection, reconnects it when possible, and restarts the service if it stays stuck.",
      },
      {
        title: "Clearer help for new testers",
        detail: "The setup guide now explains the one-click update process in simple terms, with no GitHub account required for public beta updates.",
      },
    ],
  },
  {
    version: "0.4.0",
    releasedAt: "2026-08-05",
    headline: "A smoother, more personal AmirOS",
    notes: [
      {
        title: "Settings now save themselves",
        detail: "Changes are saved automatically as you make them. A small confirmation appears and fades away once AmirOS has safely stored the update.",
      },
      {
        title: "A more personal first setup",
        detail: "New users can add their name, choose an illustrated avatar and color theme, connect OpenAI, link WhatsApp, and choose what AmirOS may learn before opening the dashboard.",
      },
      {
        title: "Cleaner chats and profile photos",
        detail: "Chats keep their time order and return to your previous position. Profile photos can be cropped, repositioned, saved as a collection, and removed individually.",
      },
      {
        title: "More reliable calendar suggestions",
        detail: "AmirOS now respects the exact time written in a message, handles same-day weekday references more accurately, and gives clearer Apple Calendar subscription guidance.",
      },
    ],
  },
  {
    version: "0.3.0",
    releasedAt: "2026-08-05",
    headline: "A simpler, smarter first start",
    notes: [
      {
        title: "Set up everything in one place",
        detail: "New users can add their own OpenAI API key and link WhatsApp with a QR code without leaving the welcome guide.",
      },
      {
        title: "You choose what AmirOS learns",
        detail: "Choose approval-first, private-chat tracking, or no tracking for new chats.",
      },
      {
        title: "Every update stays easy to follow",
        detail: "Browse a simple history of What’s new notes directly in AmirOS.",
      },
    ],
  },
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
