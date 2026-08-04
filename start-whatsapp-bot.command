#!/bin/zsh

set -u

PROJECT_DIR="${0:A:h}"
DASHBOARD_URL="http://127.0.0.1:3789"
PID_FILE="$PROJECT_DIR/work/amiros.pid"

cd "$PROJECT_DIR" || exit 1
mkdir -p "$PROJECT_DIR/work"

amiros_is_available() {
  /usr/bin/curl --fail --silent --max-time 2 "$DASHBOARD_URL/api/dashboard" >/dev/null 2>&1
}

open_dashboard() {
  if [[ "${AMIROS_NO_OPEN:-0}" != "1" ]] && [[ -x /usr/bin/open ]]; then
    /usr/bin/open "$DASHBOARD_URL"
  fi
}

if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  echo "Node.js was not found. Install Node.js 20 or newer, then try again."
  read -r "?Press Return to close..."
  exit 1
fi

if amiros_is_available; then
  echo "AmirOS is already running in the background."
  echo "Opening the control center at $DASHBOARD_URL"
  open_dashboard
  exit 0
fi

if [[ -f "$PID_FILE" ]]; then
  RECORDED_PID="$(<"$PID_FILE")"
  if [[ "$RECORDED_PID" =~ '^[0-9]+$' ]] && kill -0 "$RECORDED_PID" 2>/dev/null; then
    echo "AmirOS process $RECORDED_PID is still starting."
  else
    rm -f "$PID_FILE"
  fi
fi

if [[ ! -f "$PID_FILE" ]]; then
  echo "Starting AmirOS in the background..."
  "$NODE_BIN" scripts/launch-amiros.mjs
fi

AMIROS_PID="$(<"$PID_FILE")"
echo "Background process: $AMIROS_PID"
echo "You can close this Terminal window after the dashboard opens. AmirOS will keep monitoring itself."
echo "Use stop-whatsapp-bot.command when you want to stop AmirOS."
echo "Model selection is available inside AmirOS under Usage."

for _attempt in {1..60}; do
  if amiros_is_available; then
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
