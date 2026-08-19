import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = resolve(root, "release", "AmirOS");
const excludedRelativePaths = new Set([
  "src/profile-pdf 2.ts",
]);
const forbiddenReleaseEntries = [
  ".env.local",
  "work",
  ".wwebjs_auth",
  ".wwebjs_cache",
  "node_modules",
];

function includeReleasePath(source) {
  const relativePath = source.slice(root.length + 1);
  if (!relativePath) return true;
  if (source.endsWith("/.DS_Store")) return false;
  return !excludedRelativePaths.has(relativePath);
}

// This is intentionally an allow-list. No runtime state, credentials,
// WhatsApp session, logs, marketing exports, or generated customer data can
// enter a release by accident.
const included = [
  ".env.example",
  ".gitignore",
  "README.md",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "vitest.config.ts",
  "src",
  "tests",
  "ui",
  "scripts/build-freshness.mjs",
  "scripts/build-backend.mjs",
  "scripts/build-ui.mjs",
  "scripts/amiros-watchdog.mjs",
  "scripts/launch-agent.mjs",
  "scripts/launch-agent-runner.sh",
  "scripts/launch-amiros.mjs",
  "scripts/profile-pdf.py",
  "scripts/start-backend.mjs",
  "start-whatsapp-bot.command",
  "stop-whatsapp-bot.command",
  "Open AmirOS.command",
  "Install AmirOS.command",
  "Update AmirOS.command",
];

rmSync(releaseRoot, { recursive: true, force: true });
mkdirSync(releaseRoot, { recursive: true });
for (const entry of included) {
  const source = resolve(root, entry);
  if (!existsSync(source)) throw new Error(`Missing release file: ${entry}`);
  cpSync(source, resolve(releaseRoot, entry), { recursive: true, filter: includeReleasePath });
}

// The official beta ZIP receives only non-secret beta configuration from the
// tracked example file. It starts new testers in the approved-device flow,
// while `.env.local` remains private and always takes precedence.
const exampleEnvironment = readFileSync(resolve(root, ".env.example"), "utf8");
const betaConfigurationLines = ["AMIROS_CONTROL_CENTER_URL", "AMIROS_BETA_SUPPORT_EMAIL", "AMIROS_BETA_SUPPORT_URL"]
  .flatMap((name) => exampleEnvironment.match(new RegExp(`^${name}=.+$`, "m"))?.[0] || []);
if (betaConfigurationLines.length > 0) {
  writeFileSync(resolve(releaseRoot, ".env"), [
    "# AmirOS private-beta configuration. You may override non-sensitive choices in .env.local.",
    "# New testers must connect and approve this Mac before normal AmirOS access.",
    "AMIROS_REQUIRE_CONTROL_CENTER_ACTIVATION=true",
    ...betaConfigurationLines,
    "",
  ].join("\n"), { encoding: "utf8", mode: 0o600 });
}

// Keep the allow-list honest. These paths are where a local installation can
// hold credentials, WhatsApp authentication, and personal state; a customer
// archive must never contain them, even if the release script changes later.
for (const relativePath of forbiddenReleaseEntries) {
  if (existsSync(resolve(releaseRoot, relativePath))) {
    throw new Error(`Refusing to package private local data: ${relativePath}`);
  }
}
const packagedEnvironmentPath = resolve(releaseRoot, ".env");
if (existsSync(packagedEnvironmentPath) && /^OPENAI_API_KEY=.+$/m.test(readFileSync(packagedEnvironmentPath, "utf8"))) {
  throw new Error("Refusing to package a non-empty OPENAI_API_KEY.");
}

writeFileSync(resolve(releaseRoot, "CUSTOMER-START-HERE.md"), `# Welcome to AmirOS

This is a clean customer copy. It contains no WhatsApp link, API key, contact
memory, calendar entries, activity history, or profile data from the developer.

1. Install the Node.js LTS release from https://nodejs.org/en/download.
2. Double-click \`Install AmirOS.command\` and keep its window open until the
   AmirOS dashboard opens.
3. In AmirOS, connect this Mac to your approved AmirOS Control Center account.
   The dashboard becomes available after you approve the connection there.
4. Complete first-run setup to add your own OpenAI API key, choose a monthly
   AmirOS spend limit, then link WhatsApp with the QR code.

Your private local data is created only after setup:

- \`work/amiros-state.json\` — AmirOS knowledge, settings, calendar, and history
- \`.wwebjs_auth/\` — WhatsApp linked-device session
- \`.env.local\` — your OpenAI API key

Keep all three private. They are intentionally excluded from Git and releases.

When an update is available, double-click \`Update AmirOS.command\`. It creates
a private backup first, installs the newest AmirOS files, preserves your data,
and reopens the dashboard.

## If AmirOS does not open

Double-click \`Open AmirOS.command\` in this folder. It safely starts or
recovers AmirOS and opens the dashboard. If it still does not open, take a
screenshot of the window and send it to AmirOS Support.
`, { encoding: "utf8", mode: 0o644 });

console.log(`Created clean customer release: ${releaseRoot}`);
