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

If macOS says it cannot open the file, Control-click **Install AmirOS.command**,
choose **Open**, then choose **Open** again.

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

If macOS blocks the launcher, Control-click the file, choose **Open**, then
choose **Open** again.

## 5. Complete first-run setup

1. In AmirOS, open **Settings**.
2. Add your own OpenAI API key and set a monthly spend limit.
3. Choose the text, image, and voice model settings you prefer.
4. Under **WhatsApp linked device**, choose **Link WhatsApp**.
5. On your phone, open **WhatsApp → Settings → Linked Devices → Link a Device**
   and scan the QR code shown in AmirOS.
6. Send `!bot hello` in WhatsApp's **Message yourself** chat to test it.

## Updating AmirOS during the beta

### If you downloaded a ZIP

Download the newest AmirOS ZIP that your tester coordinator sends you and unzip
it into a new folder. Run **Install AmirOS.command** in the new folder, then
follow the private-data steps below. Keep the old folder until you confirm the
new version works.

### If you cloned with Git (technical testers only)

Quit AmirOS, then run this inside its folder:

```bash
git pull --ff-only
npx --yes pnpm@10 install --frozen-lockfile
npx --yes pnpm@10 ui:build
```

Then double-click **Open AmirOS.command** again.

## Keeping your data during an update

Your private data is not stored in Git and must never be shared:

- `.env.local` — OpenAI API key and local settings
- `work/amiros-state.json` — saved knowledge, calendar, preferences, and history
- `.wwebjs_auth/` — WhatsApp linked-device session

For a ZIP-based update, copy those items from the old AmirOS folder to the new
one **only while AmirOS is stopped**. Never upload them, commit them, or send
them to support. If anything goes wrong, keep the old folder as a backup and
re-link WhatsApp from Settings if needed.

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
