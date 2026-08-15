# AmirOS tester setup (macOS)

This guide is for early-access testers. AmirOS currently runs locally on a Mac
and connects to WhatsApp as a linked companion device. Your messages, contact
knowledge, WhatsApp session, and OpenAI key stay on your computer.

## Before you begin

You need:

- A Mac running macOS 13 or later
- Google Chrome or Chromium
- WhatsApp on your phone
- An OpenAI API key with billing enabled

> AmirOS uses an unofficial WhatsApp Web integration. Use a separate or
> non-critical number while testing, and avoid bulk or unsolicited messaging.

## 1. Download AmirOS

Download the AmirOS ZIP that your tester coordinator sends you. Double-click the
ZIP to unzip it, then move the unzipped **AmirOS** folder to your **Documents**
folder. Keep that folder there; AmirOS needs it each time it starts.

> The ZIP is a clean copy. It does not include anyone else's WhatsApp account,
> messages, saved knowledge, calendar, or OpenAI key.

## 2. Install Node.js once

1. Open [nodejs.org/en/download](https://nodejs.org/en/download).
2. Under **LTS**, download the **macOS Installer (.pkg)** for your Mac.
3. Double-click the downloaded `.pkg` file.
4. Keep choosing **Continue** and **Install**. Enter your Mac password if asked.
5. When it finishes, close the installer.

You only do this once per Mac.

## 3. Double-click to install AmirOS

1. Open the AmirOS folder in Finder.
2. Double-click **Install AmirOS.command**.
3. A Terminal window opens and installs AmirOS automatically. Keep it open.
4. After a few minutes, AmirOS opens in your browser.

### If macOS says “Install AmirOS.command Not Opened”

This is a one-time macOS security check for a download that has not yet been
signed and notarized by Apple. Only continue if you received the AmirOS ZIP
directly from your trusted tester coordinator.

1. In that message, click **Done** — do **not** choose Move to Trash.
2. Open **Apple menu → System Settings → Privacy & Security**.
3. Scroll down to **Security** and click **Open Anyway** next to the AmirOS
   message.
4. Click **Open** in the confirmation message. Your Mac password or Touch ID
   may be requested.
5. Return to the AmirOS folder and double-click **Install AmirOS.command**
   again.

macOS remembers this approval for that launcher, so it should not ask again.
If you do not see **Open Anyway**, try Control-clicking **Install
AmirOS.command** in Finder, choose **Open**, then choose **Open** again.

You do not need to type or copy any commands for the normal setup.

### Optional: technical setup

Only use this if someone from the AmirOS team asks you to:

```bash
npx --yes pnpm@10 install --frozen-lockfile
npx --yes pnpm@10 ui:build
```

## 4. Start AmirOS later

In Finder, open the AmirOS folder and double-click **Open AmirOS.command**.
Approve macOS's prompt if it appears. AmirOS opens its local dashboard at:

```text
http://127.0.0.1:3789
```

If macOS blocks the launcher, follow the same **Privacy & Security → Open
Anyway** steps above. You only need to approve each launcher once.

## 5. Complete first-run setup

1. In AmirOS, open **Settings**.
2. Add your own OpenAI API key and set a monthly spend limit.
3. Choose the text, image, and voice model settings you prefer.
4. Under **WhatsApp linked device**, choose **Link WhatsApp**.
5. On your phone, open **WhatsApp → Settings → Linked Devices → Link a Device**
   and scan the QR code shown in AmirOS.
6. Send `!bot hello` in WhatsApp's **Message yourself** chat to test it.

## Updating AmirOS

When you are told an update is available, double-click
**Update AmirOS.command** inside your existing AmirOS folder. Keep the Terminal
window open until AmirOS opens again in your browser.

The updater automatically:

1. Stops AmirOS safely.
2. Creates a private backup beside the app in **AmirOS Backups**.
3. Downloads and installs the newest app files.
4. Restores your own data.
5. Opens the updated dashboard.

You do not need a GitHub account, and you do not need to copy files manually.

## Your private data

## Beta help and feedback

The official private-beta support address is stored in the tracked
`.env.example`. This lets an existing install receive the official destination
after an update without replacing its private `.env` file. To change it for a
different private beta, add a monitored support address in `.env.local` before
starting AmirOS:

```dotenv
AMIROS_BETA_SUPPORT_EMAIL=amirfriedman@icloud.com
# Optional fallback if email is deliberately not configured:
AMIROS_BETA_SUPPORT_URL=https://support.example.com/amiros-beta
```

An explicit `.env.local` or `.env` value takes precedence over the official
default. The **Help & feedback** action prepares a report but never sends one by itself.
Testers choose what to write and whether to include basic technical details.
Any screenshot stays on their computer until they attach it in their email app.
Do not ask testers to include API keys, QR codes, or private conversations.

These items are never included in app updates and must never be shared:

- `.env.local` — OpenAI API key and local settings
- `work/amiros-state.json` — saved knowledge, calendar, preferences, and history
- `.wwebjs_auth/` — WhatsApp linked-device session

Never upload them, commit them, or send them to support. If an update cannot
finish, your last private backup remains in the **AmirOS Backups** folder next
to the app. If needed, you can re-link WhatsApp from Settings.

## Troubleshooting

- **The dashboard does not open:** visit `http://127.0.0.1:3789` directly after
  starting AmirOS.
- **Node is missing:** rerun the macOS Installer (.pkg) from
  [nodejs.org/en/download](https://nodejs.org/en/download), then double-click
  **Install AmirOS.command** again.
- **WhatsApp stops syncing:** Settings → WhatsApp linked device → **Re-link
  WhatsApp**, then scan the new QR code.
- **Need to stop AmirOS:** double-click `stop-whatsapp-bot.command` in the
  AmirOS folder.

For help, share a screenshot of the visible error and the time it occurred.
Never include your API key, `.env.local`, `.wwebjs_auth`, or `work` folder.
