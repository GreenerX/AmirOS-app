#!/bin/zsh

# First-time macOS installer for early testers. It intentionally does not read
# or create any API key, WhatsApp session, or private AmirOS knowledge.
set -u

PROJECT_DIR="${0:A:h}"
NODE_DOWNLOAD_URL="https://nodejs.org/en/download"

open_node_download() {
  if [[ -x /usr/bin/open ]]; then
    /usr/bin/open "$NODE_DOWNLOAD_URL"
  fi
}

pause() {
  read -r "?Press Return to close..."
}

cd "$PROJECT_DIR" || exit 1

# The first approval is intentionally made for this installer. Once it is
# running, clear the download quarantine marker from the rest of this trusted
# AmirOS folder so macOS does not ask the tester to approve Open/Stop AmirOS
# one file at a time.
if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "$PROJECT_DIR" 2>/dev/null || true
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
  echo
  echo "AmirOS needs Node.js before it can be installed."
  echo "Your browser will open the official Node.js download page now."
  echo
  echo "1. Download the LTS version for macOS."
  echo "2. Open the downloaded .pkg file and follow the installer."
  echo "3. Return here and double-click Install AmirOS.command again."
  open_node_download
  pause
  exit 1
fi

echo
echo "Installing AmirOS. This can take a few minutes the first time."
echo "Keep this window open until AmirOS opens in your browser."
echo

if ! npx --yes pnpm@10 install --frozen-lockfile; then
  echo
  echo "AmirOS could not install its required files."
  echo "Check your internet connection, then run Install AmirOS.command again."
  pause
  exit 1
fi

if ! npx --yes pnpm@10 ui:build; then
  echo
  echo "AmirOS could not build its dashboard."
  echo "Please take a screenshot of this window and send it to AmirOS support."
  pause
  exit 1
fi

echo
echo "Setup is complete. Starting AmirOS..."
exec "$PROJECT_DIR/Open AmirOS.command"
