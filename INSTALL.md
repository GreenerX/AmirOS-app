# AmirOS tester setup (macOS)

This guide is for early-access testers. AmirOS currently runs locally on a Mac
and connects to WhatsApp as a linked companion device. Your messages, contact
knowledge, WhatsApp session, and OpenAI key stay on your computer.

## Before you begin

You need:

- A Mac running macOS 13 or later
- [Node.js 20 or newer](https://nodejs.org/en/download)
- Google Chrome or Chromium
- WhatsApp on your phone
- An OpenAI API key with billing enabled
- Access to the private AmirOS GitHub repository

> AmirOS uses an unofficial WhatsApp Web integration. Use a separate or
> non-critical number while testing, and avoid bulk or unsolicited messaging.

## 1. Download AmirOS

The project owner must first invite you as a collaborator to the private GitHub
repository. Accept that invitation while signed into GitHub.

Then open the repository, select **Code → Download ZIP**, and unzip the download
somewhere you can keep it, such as `Documents/AmirOS`.

If you are comfortable with Git, cloning is also supported:

```bash
git clone https://github.com/GreenerX/AmirOS-app.git
cd AmirOS-app
```

## 2. Install the app dependencies

Open **Terminal**, type `cd ` (including the space), then drag the unzipped
AmirOS folder into the Terminal window and press Return. Run:

```bash
npm install --global pnpm
pnpm install --frozen-lockfile
pnpm ui:build
```

This is only needed the first time, or after an update that changes dependencies.

## 3. Start AmirOS

In Finder, open the AmirOS folder and double-click **Open AmirOS.command**.
Approve macOS's prompt if it appears. AmirOS opens its local dashboard at:

```text
http://127.0.0.1:3789
```

If macOS blocks the launcher, Control-click the file, choose **Open**, then
choose **Open** again.

## 4. Complete first-run setup

1. In AmirOS, open **Settings**.
2. Add your own OpenAI API key and set a monthly spend limit.
3. Choose the text, image, and voice model settings you prefer.
4. Under **WhatsApp linked device**, choose **Link WhatsApp**.
5. On your phone, open **WhatsApp → Settings → Linked Devices → Link a Device**
   and scan the QR code shown in AmirOS.
6. Send `!bot hello` in WhatsApp's **Message yourself** chat to test it.

## Updating AmirOS during the beta

### If you downloaded a ZIP

Download the newest ZIP from GitHub, unzip it into a new folder, then repeat
step 2. Your old folder keeps your existing local data, so do **not** delete it
until you have copied its private data as described below.

### If you cloned with Git

Quit AmirOS, then run this inside its folder:

```bash
git pull --ff-only
pnpm install --frozen-lockfile
pnpm ui:build
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
- **Node or pnpm is missing:** reinstall the current Node.js LTS release, close
  Terminal, reopen it, and repeat step 2.
- **WhatsApp stops syncing:** Settings → WhatsApp linked device → **Re-link
  WhatsApp**, then scan the new QR code.
- **Need to stop AmirOS:** double-click `stop-whatsapp-bot.command` in the
  AmirOS folder.

For help, share a screenshot of the visible error and the time it occurred.
Never include your API key, `.env.local`, `.wwebjs_auth`, or `work` folder.
