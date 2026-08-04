import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = resolve(root, "release", "AmirOS");

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
  "scripts/amiros-watchdog.mjs",
  "scripts/launch-amiros.mjs",
  "scripts/profile-pdf.py",
  "start-whatsapp-bot.command",
  "stop-whatsapp-bot.command",
  "Open AmirOS.command",
  "Install AmirOS.command",
];

rmSync(releaseRoot, { recursive: true, force: true });
mkdirSync(releaseRoot, { recursive: true });
for (const entry of included) {
  const source = resolve(root, entry);
  if (!existsSync(source)) throw new Error(`Missing release file: ${entry}`);
  cpSync(source, resolve(releaseRoot, entry), { recursive: true });
}

writeFileSync(resolve(releaseRoot, "CUSTOMER-START-HERE.md"), `# Welcome to AmirOS

This is a clean customer copy. It contains no WhatsApp link, API key, contact
memory, calendar entries, activity history, or profile data from the developer.

1. Install the Node.js LTS release from https://nodejs.org/en/download.
2. Double-click \`Install AmirOS.command\` and keep its window open until the
   AmirOS dashboard opens.
3. Open Settings, add your OpenAI API key, choose a monthly AmirOS spend limit,
   then link WhatsApp with the QR code.

Your private local data is created only after setup:

- \`work/amiros-state.json\` — AmirOS knowledge, settings, calendar, and history
- \`.wwebjs_auth/\` — WhatsApp linked-device session
- \`.env.local\` — your OpenAI API key

Keep all three private. They are intentionally excluded from Git and releases.
`, { encoding: "utf8", mode: 0o644 });

console.log(`Created clean customer release: ${releaseRoot}`);
