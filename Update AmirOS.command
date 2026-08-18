#!/bin/zsh

# One-click updater for macOS testers. It updates AmirOS itself while keeping
# the owner's credentials, WhatsApp link, local knowledge, calendar, and
# profile assets on this Mac.
set -u

PROJECT_DIR="${0:A:h}"
BACKUP_ROOT="${PROJECT_DIR:h}/AmirOS Backups"
UPDATE_REPOSITORY="https://github.com/GreenerX/AmirOS-app"
GITHUB_RELEASE_API="https://api.github.com/repos/GreenerX/AmirOS-app/releases/latest"
PID_FILE="$PROJECT_DIR/work/amiros.pid"
APPROVED_UPDATE_FILE="$PROJECT_DIR/work/approved-update.json"
CONTROLLED_UPDATE_STATE="absent"
CONTROLLED_UPDATE_VERSION=""
CONTROLLED_UPDATE_URL=""
CONTROLLED_UPDATE_SHA256=""

pause() {
  read -r "?Press Return to close..."
}

fail() {
  echo
  echo "Update stopped: $1"
  echo "Your private AmirOS data has not been removed."
  pause
  exit 1
}

find_node() {
  for candidate in \
    "$(command -v node 2>/dev/null || true)" \
    "/opt/homebrew/bin/node" \
    "/usr/local/bin/node" \
    "/opt/homebrew/opt/node@22/bin/node" \
    "/opt/homebrew/opt/node@20/bin/node" \
    "$HOME/.volta/bin/node" \
    "$HOME/.asdf/shims/node"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

stop_amiros() {
  local recorded_pid=""
  if [[ -f "$PID_FILE" ]]; then
    recorded_pid="$(<"$PID_FILE")"
  fi
  if [[ "$recorded_pid" =~ '^[0-9]+$' ]] && /bin/kill -0 "$recorded_pid" 2>/dev/null; then
    echo "Stopping AmirOS safely..."
    /bin/kill -TERM "$recorded_pid"
    for _attempt in {1..20}; do
      if ! /bin/kill -0 "$recorded_pid" 2>/dev/null; then
        break
      fi
      sleep 1
    done
  fi
  rm -f "$PID_FILE"
}

backup_private_data() {
  BACKUP_DIR="$BACKUP_ROOT/$(date '+%Y-%m-%d-%H%M%S')"
  mkdir -p "$BACKUP_DIR" || return 1
  # The updater explicitly excludes the WhatsApp session from every install
  # operation, so it remains safely in place. Copying its Chrome profile can
  # take a very long time (and makes an otherwise small update look stuck).
  # Back up the smaller configuration and AmirOS state directory instead.
  for private_item in .env.local .env work; do
    if [[ -e "$PROJECT_DIR/$private_item" ]]; then
      /usr/bin/ditto "$PROJECT_DIR/$private_item" "$BACKUP_DIR/$private_item" || return 1
    fi
  done
}

restore_private_data() {
  for private_item in .env.local .env work; do
    if [[ -e "$BACKUP_DIR/$private_item" ]]; then
      /usr/bin/ditto "$BACKUP_DIR/$private_item" "$PROJECT_DIR/$private_item" || return 1
    fi
  done
}

latest_release_tag() {
  local temporary_directory="$1"
  local release_metadata="$temporary_directory/latest-release.json"
  /usr/bin/curl --fail --location --silent --show-error \
    -H "Accept: application/vnd.github+json" \
    "$GITHUB_RELEASE_API" \
    --output "$release_metadata" || return 1
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const release = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const tag = typeof release.tag_name === "string" ? release.tag_name.trim() : "";
    if (!tag || release.draft === true || release.prerelease === true || !/^v?[0-9]+\.[0-9]+\.[0-9]+$/.test(tag)) process.exit(1);
    process.stdout.write(tag);
  ' "$release_metadata"
}

managed_release_rollout_enabled() {
  local settings_file
  for settings_file in "$PROJECT_DIR/.env.local" "$PROJECT_DIR/.env"; do
    [[ -f "$settings_file" ]] || continue
    /usr/bin/grep -Eq '^[[:space:]]*AMIROS_REQUIRE_CONTROL_CENTER_ACTIVATION[[:space:]]*=[[:space:]]*(true|1)[[:space:]]*(#.*)?$' "$settings_file" && return 0
  done
  return 1
}

# The dashboard writes this short-lived, mode-0600 plan only after an owner
# explicitly chooses an update that the Control Center approved for this Mac.
# It is consumed before any private-data backup so stale plans cannot be
# restored and reused later.
load_approved_update_plan() {
  [[ -f "$APPROVED_UPDATE_FILE" ]] || return 1
  local values exit_status
  values="$("$NODE_BIN" -e '
    const fs = require("node:fs");
    const plan = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const version = typeof plan.version === "string" ? plan.version.trim().replace(/^v/i, "") : "";
    const url = typeof plan.downloadUrl === "string" ? new URL(plan.downloadUrl) : null;
    const sha = typeof plan.sha256 === "string" ? plan.sha256.trim() : "";
    const expiresAt = typeof plan.expiresAt === "string" ? Date.parse(plan.expiresAt) : NaN;
    if (!/^\d+\.\d+\.\d+$/.test(version) || !url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !/^[a-f0-9]{64}$/.test(sha) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) process.exit(1);
    process.stdout.write([version, url.toString(), sha].join("\t"));
  ' "$APPROVED_UPDATE_FILE" 2>/dev/null)"
  exit_status=$?
  /bin/rm -f "$APPROVED_UPDATE_FILE"
  if [[ "$exit_status" -ne 0 || -z "$values" ]]; then
    CONTROLLED_UPDATE_STATE="invalid"
    return 2
  fi
  IFS=$'\t' read -r CONTROLLED_UPDATE_VERSION CONTROLLED_UPDATE_URL CONTROLLED_UPDATE_SHA256 <<< "$values"
  if [[ -z "$CONTROLLED_UPDATE_VERSION" || -z "$CONTROLLED_UPDATE_URL" || -z "$CONTROLLED_UPDATE_SHA256" ]]; then
    CONTROLLED_UPDATE_STATE="invalid"
    return 2
  fi
  CONTROLLED_UPDATE_STATE="available"
  return 0
}

update_from_git() {
  # Do not silently overwrite any developer changes. Private runtime data is
  # ignored by Git and will not make this check fail.
  if [[ -n "$(/usr/bin/git -C "$PROJECT_DIR" status --porcelain --untracked-files=no)" ]]; then
    return 2
  fi
  /usr/bin/git -C "$PROJECT_DIR" fetch origin "refs/tags/${RELEASE_TAG}:refs/tags/${RELEASE_TAG}" || return 1
  /usr/bin/git -C "$PROJECT_DIR" checkout --detach "$RELEASE_TAG" || return 1
}

prepare_release_zip() {
  local temporary_directory="$1"
  local archive_path="$temporary_directory/AmirOS.zip"
  if [[ "$CONTROLLED_UPDATE_STATE" == "available" ]]; then
    echo "Downloading approved AmirOS $RELEASE_TAG..."
    /usr/bin/curl --fail --location --silent --show-error \
      "$CONTROLLED_UPDATE_URL" \
      --output "$archive_path" || return 1
    local downloaded_sha256
    downloaded_sha256="$(/usr/bin/shasum -a 256 "$archive_path" | /usr/bin/awk '{print $1}')"
    [[ "$downloaded_sha256" == "$CONTROLLED_UPDATE_SHA256" ]] || return 1
  else
    echo "Downloading AmirOS $RELEASE_TAG..."
    /usr/bin/curl --fail --location --silent --show-error \
      "$UPDATE_REPOSITORY/archive/refs/tags/${RELEASE_TAG}.zip" \
      --output "$archive_path" || return 1
  fi
  /usr/bin/unzip -q "$archive_path" -d "$temporary_directory" || return 1
  RELEASE_SOURCE_DIRECTORY="$(/usr/bin/find "$temporary_directory" -mindepth 1 -maxdepth 3 -type f -name package.json -exec /usr/bin/dirname {} \; -quit)"
  [[ -n "$RELEASE_SOURCE_DIRECTORY" ]] || return 1
}

install_release_zip() {
  local source_directory="$1"
  # This intentionally merges code files only. The exclusions ensure a
  # downloaded release can never replace private data, installed dependencies,
  # or a user's local Git history.
  /usr/bin/rsync -a \
    --exclude '.env' \
    --exclude '.env.local' \
    --exclude '.wwebjs_auth' \
    --exclude 'work' \
    --exclude 'node_modules' \
    --exclude '.git' \
    "$source_directory/" "$PROJECT_DIR/" || return 1
}

cd "$PROJECT_DIR" || exit 1
mkdir -p "$PROJECT_DIR/work" || fail "AmirOS could not prepare its local runtime folder."
NODE_BIN="$(find_node || true)"
[[ -n "$NODE_BIN" ]] || fail "Node.js was not found. Install Node.js 20 or newer, then try again."
NPX_BIN="${NODE_BIN:h}/npx"
if [[ ! -x "$NPX_BIN" ]]; then
  NPX_BIN="$(command -v npx 2>/dev/null || true)"
fi
[[ -n "$NPX_BIN" && -x "$NPX_BIN" ]] || fail "Node.js is installed, but its installer command could not be found. Reinstall the Node.js LTS version, then try again."

if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "$PROJECT_DIR" 2>/dev/null || true
fi

echo
echo "Updating AmirOS..."
echo "First checking that a safe update is available..."
echo

TEMPORARY_DIRECTORY="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/amiros-update.XXXXXX")" || fail "AmirOS could not prepare the update."
trap 'rm -rf "$TEMPORARY_DIRECTORY"' EXIT

if load_approved_update_plan; then
  RELEASE_TAG="v${CONTROLLED_UPDATE_VERSION}"
  echo "Approved release found: $RELEASE_TAG"
  prepare_release_zip "$TEMPORARY_DIRECTORY" || fail "AmirOS could not download the approved update. Check your internet connection and try again."
  INSTALL_FROM_RELEASE_ZIP=true
else
  if [[ "$CONTROLLED_UPDATE_STATE" == "invalid" ]]; then
    fail "This approved update link expired or could not be verified. Return to AmirOS and try the update again."
  fi
  if managed_release_rollout_enabled; then
    fail "This managed AmirOS copy updates only from the approved release shown in AmirOS. Return to the dashboard and try again."
  fi
  RELEASE_TAG="$(latest_release_tag "$TEMPORARY_DIRECTORY" || true)"
  [[ -n "$RELEASE_TAG" ]] || fail "AmirOS could not find a published update. Check your internet connection and try again."
  echo "Published release found: $RELEASE_TAG"
  if [[ -d "$PROJECT_DIR/.git" ]] && /usr/bin/git -C "$PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if [[ -n "$(/usr/bin/git -C "$PROJECT_DIR" status --porcelain --untracked-files=no)" ]]; then
      fail "This copy has local app changes. AmirOS left them untouched; ask the app owner to release those changes before updating."
    fi
    /usr/bin/git -C "$PROJECT_DIR" fetch origin "refs/tags/${RELEASE_TAG}:refs/tags/${RELEASE_TAG}" || fail "AmirOS could not download the update. Check your internet connection and try again."
    INSTALL_FROM_RELEASE_ZIP=false
  else
    prepare_release_zip "$TEMPORARY_DIRECTORY" || fail "AmirOS could not download the update. Check your internet connection and try again."
    INSTALL_FROM_RELEASE_ZIP=true
  fi
fi

echo "Update package is ready. Backing up your private AmirOS data..."
stop_amiros
backup_private_data || fail "AmirOS could not back up your private data."
echo "Private data backup created at: $BACKUP_DIR"

if [[ "$INSTALL_FROM_RELEASE_ZIP" != "true" ]]; then
  update_from_git || fail "AmirOS could not install the downloaded update. Your private backup is safe at: $BACKUP_DIR"
else
  install_release_zip "$RELEASE_SOURCE_DIRECTORY" || fail "AmirOS could not install the downloaded update. Your private backup is safe at: $BACKUP_DIR"
fi

restore_private_data || fail "The new AmirOS files are installed, but your private backup could not be restored. Your backup remains at: $BACKUP_DIR"
# The plan is an authorisation to start one exact update, not private data to
# preserve. Removing it after restore prevents a backup from replaying it.
/bin/rm -f "$APPROVED_UPDATE_FILE"

echo "Installing the updated AmirOS files..."
if ! "$NPX_BIN" --yes pnpm@10 install --frozen-lockfile; then
  fail "AmirOS could not install its updated components. Your private backup is safe at: $BACKUP_DIR"
fi
if ! "$NPX_BIN" --yes pnpm@10 build; then
  fail "AmirOS could not rebuild its background service. Your private backup is safe at: $BACKUP_DIR"
fi
if ! "$NPX_BIN" --yes pnpm@10 ui:build; then
  fail "AmirOS could not rebuild its dashboard. Your private backup is safe at: $BACKUP_DIR"
fi

if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "$PROJECT_DIR" 2>/dev/null || true
fi

echo
echo "AmirOS is up to date. Opening your dashboard..."
exec "$PROJECT_DIR/Open AmirOS.command"
