# AmirOS release notes

## v0.2.2 — August 4, 2026

- Made `stop-whatsapp-bot.command` reliably locate and stop AmirOS if its PID record is unavailable.
- The recommended everyday controls are now `Open AmirOS.command` to launch and `stop-whatsapp-bot.command` to stop.

## v0.2.1 — August 4, 2026

- Fixed the Finder launcher so it finds Node.js from common Homebrew, Volta, and asdf locations.
- Added a temporary developer-only fallback for this Mac while Node.js is being installed system-wide.

## v0.2.0 — August 4, 2026

- Added a first-run setup that introduces API-key, budget, and WhatsApp linking steps.
- Added an in-app version button and a “What’s new” popup for each new release.
- The dashboard version now comes from the same `package.json` version used for Git releases.

## v0.1.0

- Initial clean AmirOS source release.
