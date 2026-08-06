#!/bin/zsh

# First-time macOS installer for early testers. It intentionally does not read
# or create any API key, WhatsApp session, or private AmirOS knowledge.
set -u

PROJECT_DIR="${0:A:h}"
NODE_DOWNLOAD_URL="https://nodejs.org/en/download"

# AmirOS keeps every private item beside the app itself. When a person has
# downloaded a newer ZIP into a second AmirOS folder, look only at sibling
# AmirOS folders for a prior local installation. This is deliberately narrow:
# it will never search a whole home folder or copy data from an unrelated app.
has_private_amiros_data() {
  local directory="$1"
  [[ -f "$directory/.env.local" || -f "$directory/.env" || -d "$directory/.wwebjs_auth" || -f "$directory/work/amiros-state.json" || -d "$directory/work/profile-avatars" ]]
}

stop_existing_amiros() {
  local candidate command_line
  local parent_directory="${PROJECT_DIR:h}"
  for candidate in $(/usr/bin/pgrep -f 'amiros-watchdog\.mjs' 2>/dev/null || true); do
    [[ "$candidate" =~ '^[0-9]+$' ]] || continue
    command_line="$(/bin/ps -p "$candidate" -o command= 2>/dev/null || true)"
    # Limit this to another AmirOS copy next to the one being installed. It
    # prevents the new copy from competing for port 3789 without stopping an
    # unrelated AmirOS installation elsewhere on the computer.
    if [[ "$command_line" == *"$parent_directory/"* && "$command_line" == *"/amiros-watchdog.mjs"* ]]; then
      echo "Stopping an earlier AmirOS copy before installing the update..."
      /bin/kill -TERM "$candidate" 2>/dev/null || true
      for _attempt in {1..20}; do
        /bin/kill -0 "$candidate" 2>/dev/null || break
        sleep 1
      done
      if /bin/kill -0 "$candidate" 2>/dev/null; then
        echo "AmirOS could not stop the earlier copy. It was left running and this update was not started."
        return 1
      fi
    fi
  done
}

migrate_private_data_from_sibling() {
  local candidate selected="" candidate_mtime selected_mtime=0
  local parent_directory="${PROJECT_DIR:h}"

  # A retry in the same new folder must always keep that folder's own data.
  if has_private_amiros_data "$PROJECT_DIR"; then
    return 0
  fi

  setopt local_options null_glob
  for candidate in "$parent_directory"/*; do
    [[ -d "$candidate" && "$candidate" != "$PROJECT_DIR" ]] || continue
    [[ "${${candidate:t}:l}" == *amiros* ]] || continue
    has_private_amiros_data "$candidate" || continue
    candidate_mtime="$(/usr/bin/stat -f %m "$candidate" 2>/dev/null || echo 0)"
    if [[ -z "$selected" || "$candidate_mtime" -gt "$selected_mtime" ]]; then
      selected="$candidate"
      selected_mtime="$candidate_mtime"
    fi
  done

  [[ -n "$selected" ]] || return 0

  echo "Found private AmirOS data in ${selected:t}. Bringing it into this newer copy..."
  mkdir -p "$PROJECT_DIR/work" || return 1
  for private_item in .env.local .env .wwebjs_auth work; do
    if [[ -e "$selected/$private_item" ]]; then
      /usr/bin/ditto "$selected/$private_item" "$PROJECT_DIR/$private_item" || return 1
    fi
  done
  # Process records and logs describe the old app copy. They must not be
  # carried forward, otherwise the new launcher could mistake an old process
  # for its own or present stale diagnostics.
  rm -f "$PROJECT_DIR/work/amiros.pid" "$PROJECT_DIR/work/bot.log" "$PROJECT_DIR/work/whatsapp-qr.png"
}

open_node_download() {
  if [[ -x /usr/bin/open ]]; then
    /usr/bin/open "$NODE_DOWNLOAD_URL"
  fi
}

pause() {
  read -r "?Press Return to close..."
}

cd "$PROJECT_DIR" || exit 1
mkdir -p "$PROJECT_DIR/work" || exit 1

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

if ! stop_existing_amiros; then
  pause
  exit 1
fi
if ! migrate_private_data_from_sibling; then
  echo
  echo "AmirOS could not safely copy private data from the previous installation."
  echo "Your earlier AmirOS folder was not changed. Please try again or contact support."
  pause
  exit 1
fi

if ! npx --yes pnpm@10 install --frozen-lockfile; then
  echo
  echo "AmirOS could not install its required files."
  echo "Check your internet connection, then run Install AmirOS.command again."
  pause
  exit 1
fi

if ! npx --yes pnpm@10 build; then
  echo
  echo "AmirOS could not build its background service."
  echo "Please take a screenshot of this window and send it to AmirOS support."
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
