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
  releasedAt: "2026-08-09",
  headline: "A calmer, more useful daily command center",
  notes: [
    {
      title: "A clearer Overview",
      detail: "Today’s Focus, the adaptive day Agenda, to-dos, Suggested action, activity, weather, clocks, and sidebar now work together in a cleaner daily layout.",
    },
    {
      title: "People feel personal",
      detail: "Favorites, hidden contacts, relationship summaries, contact profiles, and clearer follow-up and upcoming views make the People directory easier to use.",
    },
    {
      title: "Smarter follow-up guidance",
      detail: "AmirOS combines deterministic reply signals with cached AI review only for uncertain conversations, and shows confidence without overstating certainty.",
    },
    {
      title: "More durable knowledge",
      detail: "Approved or dismissed relationship knowledge stays reviewed instead of returning as a reworded suggestion.",
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
    version: "0.7.1",
    releasedAt: "2026-08-09",
    headline: "A reliable update for every tester",
    notes: [
      {
        title: "Updates rebuild cleanly",
        detail: "The update build now compiles the AmirOS service only. Test-only dashboard files no longer prevent an update from finishing.",
      },
      {
        title: "v0.7.0 improvements are ready to install",
        detail: "The People experience, clearer Overview, durable knowledge review, and navigation polish can now install as intended.",
      },
    ],
  },
  {
    version: "0.7.0",
    releasedAt: "2026-08-09",
    headline: "A more personal People experience",
    notes: [
      {
        title: "People is now your relationship directory",
        detail: "Browse the people AmirOS knows through concise relationship cards, Favorites, Quick Views, search, filters, and a dedicated contact profile.",
      },
      {
        title: "Your day is clearer at a glance",
        detail: "Today’s Focus, a today-only Agenda, and the to-do list now present the next useful actions with stronger identity and calmer layout.",
      },
      {
        title: "Reviewed knowledge stays reviewed",
        detail: "Approved and dismissed relationship details now remain suppressed even when a new message phrases the same information differently.",
      },
      {
        title: "Navigation feels more intentional",
        detail: "Sidebar icons now have clearer active states, and the all-clear Next best action card no longer redirects to People.",
      },
    ],
  },
  {
    version: "0.6.8",
    releasedAt: "2026-08-07",
    headline: "A correct version identity and smoother updates",
    notes: [
      {
        title: "Updates now finish cleanly",
        detail: "AmirOS now reports the installed release version correctly, so a completed update no longer reappears as pending.",
      },
      {
        title: "Your private data remains protected",
        detail: "The update process continues to back up and restore your local settings, knowledge, calendar, tasks, profile, API key, and WhatsApp link.",
      },
    ],
  },
  {
    version: "0.6.7",
    releasedAt: "2026-08-07",
    headline: "Smarter memory and proactive assistance",
    notes: [
      {
        title: "Smarter memory in English and Hebrew",
        detail: "Time-based questions such as “What did I do yesterday?” and “מה עשיתי אתמול?” now use the correct time window in both the dashboard and WhatsApp.",
      },
      {
        title: "Attention when it matters",
        detail: "Attention Needed highlights important upcoming and overdue commitments, to-dos, and calendar events.",
      },
      {
        title: "A cleaner daily workflow",
        detail: "Next Best Action, to-dos, and task workflows are simpler and easier to use.",
      },
    ],
  },
  {
    version: "0.6.6",
    releasedAt: "2026-08-07",
    headline: "Clearer Overview actions and safer recovery",
    notes: [
      {
        title: "Overview actions open the right place",
        detail: "Next Best Action items now take you to the relevant conversation or workflow so you can act with less searching.",
      },
      {
        title: "Safer recovery after interruptions",
        detail: "AmirOS can recover the local service and restore the dashboard after a brief interruption more reliably.",
      },
    ],
  },
  {
    version: "0.6.5",
    releasedAt: "2026-08-06",
    headline: "More dependable published-release updates",
    notes: [
      {
        title: "Updates use published releases",
        detail: "The updater now checks for a finished published release and installs that exact version instead of relying on the moving main branch.",
      },
    ],
  },
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
