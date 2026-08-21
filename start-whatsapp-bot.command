#!/bin/zsh

set -u

PROJECT_DIR="${0:A:h}"
AMIROS_PORT="${AMIROS_PORT:-3789}"
DASHBOARD_URL="http://127.0.0.1:${AMIROS_PORT}"
PID_FILE="$PROJECT_DIR/work/amiros.pid"

# Test-only installer launches are deliberately isolated from the normal
# dashboard. Refuse the production port even if a future test is configured
# incorrectly; this prevents a temporary copy from ever hiding real data.
if [[ -n "${AMIROS_INSTALL_TEST_WATCHDOG_ROOT:-}" && "$AMIROS_PORT" == "3789" ]]; then
  echo "Installer QA requires an isolated local port; port 3789 belongs to the normal AmirOS dashboard."
  exit 1
fi

cd "$PROJECT_DIR" || exit 1
mkdir -p "$PROJECT_DIR/work"

amiros_is_available() {
  /usr/bin/curl --fail --silent --max-time 2 "$DASHBOARD_URL/api/dashboard" >/dev/null 2>&1
}

amiros_pid_is_watchdog() {
  local candidate="$1"
  /bin/ps -p "$candidate" -o command= 2>/dev/null | /usr/bin/grep -F "$PROJECT_DIR/scripts/amiros-watchdog.mjs" >/dev/null 2>&1
}

current_copy_is_running() {
  local recorded_pid=""
  [[ -f "$PID_FILE" ]] || return 1
  recorded_pid="$(<"$PID_FILE")"
  [[ "$recorded_pid" =~ '^[0-9]+$' ]] || return 1
  /bin/kill -0 "$recorded_pid" 2>/dev/null && amiros_pid_is_watchdog "$recorded_pid"
}

open_dashboard() {
  if [[ "${AMIROS_NO_OPEN:-0}" != "1" ]] && [[ -x /usr/bin/open ]]; then
    /usr/bin/open "$DASHBOARD_URL"
  fi
}

NODE_BIN=""

# Finder launches a non-interactive shell, which often does not inherit the
# PATH configured by Homebrew, nvm, or Volta. Check the usual macOS locations
# before showing an installation error.
for candidate in \
  "$(command -v node 2>/dev/null || true)" \
  "/opt/homebrew/bin/node" \
  "/usr/local/bin/node" \
  "/opt/homebrew/opt/node@22/bin/node" \
  "/opt/homebrew/opt/node@20/bin/node" \
  "$HOME/.volta/bin/node" \
  "$HOME/.asdf/shims/node"; do
  if [[ -n "$candidate" && -x "$candidate" ]]; then
    NODE_BIN="$candidate"
    break
  fi
done

# This exists only on the developer's Mac. It makes the local project usable
# from Finder while Node is being installed, but is not expected in customer
# releases and never replaces a normal Node installation when one is present.
if [[ -z "$NODE_BIN" && -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  NODE_BIN="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
  echo "Using the local Codex Node runtime until Node.js is installed system-wide."
fi

if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js was not found. Install Node.js 20 or newer, then try again."
  echo "Download it from https://nodejs.org/en/download"
  read -r "?Press Return to close..."
  exit 1
fi

if amiros_is_available; then
  if current_copy_is_running; then
    echo "AmirOS is already running in the background."
    echo "Opening the control center at $DASHBOARD_URL"
    open_dashboard
    exit 0
  fi
  echo "Another AmirOS copy is already using the local dashboard."
  echo "Close that copy, then open this AmirOS folder again."
  echo "This copy was not opened, so you will not see an older dashboard by mistake."
  read -r "?Press Return to close..."
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  RECORDED_PID="$(<"$PID_FILE")"
  if [[ "$RECORDED_PID" =~ '^[0-9]+$' ]] && kill -0 "$RECORDED_PID" 2>/dev/null && amiros_pid_is_watchdog "$RECORDED_PID"; then
    echo "AmirOS process $RECORDED_PID is still starting."
  else
    echo "Removing an old AmirOS process record so a fresh service can start."
    rm -f "$PID_FILE"
  fi
fi

if [[ ! -f "$PID_FILE" ]]; then
  echo "Starting AmirOS in the background..."
  if [[ -n "${AMIROS_INSTALL_TEST_WATCHDOG_ROOT:-}" ]]; then
    # The installer integration test runs under the developer's macOS user.
    # Keep its process completely isolated from the real AmirOS LaunchAgent.
    "$NODE_BIN" scripts/launch-amiros.mjs
  elif ! "$NODE_BIN" scripts/launch-agent.mjs --start; then
    echo "Automatic recovery could not be set up. Starting AmirOS normally instead."
    "$NODE_BIN" scripts/launch-amiros.mjs
  fi
fi

AMIROS_PID=""
for _attempt in {1..10}; do
  if [[ -f "$PID_FILE" ]]; then
    candidate_pid="$(<"$PID_FILE")"
    if [[ "$candidate_pid" =~ '^[0-9]+$' ]]; then
      AMIROS_PID="$candidate_pid"
      break
    fi
  fi
  sleep 1
done

if [[ -z "$AMIROS_PID" ]]; then
  echo "AmirOS could not start its background recovery service."
  echo "Please take a screenshot of this window and contact AmirOS Support."
  read -r "?Press Return to close..."
  exit 1
fi

echo "Background process: $AMIROS_PID"
echo "You can close this Terminal window after the dashboard opens. AmirOS will keep monitoring itself."
echo "Use stop-whatsapp-bot.command when you want to stop AmirOS."
echo "Model selection is available inside AmirOS under Usage."

for _attempt in {1..60}; do
  if amiros_is_available && current_copy_is_running; then
    echo "AmirOS is running in the background."
    echo "Logs: $PROJECT_DIR/work/bot.log"
    open_dashboard
    exit 0
  fi
  if ! kill -0 "$AMIROS_PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "AmirOS stopped before the dashboard became available."
    echo "Check $PROJECT_DIR/work/bot.log for details."
    read -r "?Press Return to close..."
    exit 1
  fi
  sleep 1
done

echo "AmirOS is still starting. Check $PROJECT_DIR/work/bot.log for progress."
read -r "?Press Return to close..."
exit 1
