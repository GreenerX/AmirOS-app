#!/bin/zsh

set -u
set -o pipefail

PROJECT_DIR="${0:A:h}"
BUNDLED_NODE="/Users/amirfriedman/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
DASHBOARD_URL="http://127.0.0.1:3789"
LOG_FILE="$PROJECT_DIR/work/bot.log"
PID_FILE="$PROJECT_DIR/work/amiros.pid"

cd "$PROJECT_DIR" || exit 1
mkdir -p "$PROJECT_DIR/work"

amiros_is_ready() {
  /usr/bin/curl --fail --silent --max-time 2 "$DASHBOARD_URL/api/dashboard" >/dev/null 2>&1
}

open_dashboard() {
  if [[ "${AMIROS_NO_OPEN:-0}" != "1" ]] && [[ -x /usr/bin/open ]]; then
    /usr/bin/open "$DASHBOARD_URL"
  fi
}

if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
elif [[ -x "$BUNDLED_NODE" ]]; then
  NODE_BIN="$BUNDLED_NODE"
else
  echo "Node.js was not found. Install Node.js 22 or newer, then try again."
  read -r "?Press Return to close..."
  exit 1
fi

if amiros_is_ready; then
  echo "Amiros is already running."
  echo "Opening the control center at $DASHBOARD_URL"
  open_dashboard
  exit 0
fi

echo "Starting Amiros..."
echo "Scan the QR with WhatsApp → Settings → Linked Devices → Link a Device."
echo "The control center will open automatically at $DASHBOARD_URL"
echo "You can close this Terminal window after Amiros starts."
echo "Use stop-whatsapp-bot.command when you want to stop the background service."
echo

echo "Choose an OpenAI cost profile:"
echo "  1) Economy  — lowest-cost text, image, and voice models"
echo "  2) Balanced — stronger answers and images at moderate cost"
echo "  3) Quality  — strongest models and higher image quality"
echo "Choose now, or Amiros will use Balanced automatically after 12 seconds."
read -r -t 12 "MODEL_CHOICE?Profile [2]: " || MODEL_CHOICE=""

case "${MODEL_CHOICE:-2}" in
  1) export OPENAI_MODEL_PRESET="economy" ;;
  2) export OPENAI_MODEL_PRESET="balanced" ;;
  3) export OPENAI_MODEL_PRESET="quality" ;;
  *)
    echo "Unknown choice; using Economy."
    export OPENAI_MODEL_PRESET="economy"
    ;;
esac

echo "Using the $OPENAI_MODEL_PRESET profile."
echo

echo "Starting the background service..."
/usr/bin/nohup env OPENAI_MODEL_PRESET="$OPENAI_MODEL_PRESET" \
  "$NODE_BIN" node_modules/tsx/dist/cli.mjs src/server.ts \
  >> "$LOG_FILE" 2>&1 < /dev/null &
AMIROS_PID=$!
echo "$AMIROS_PID" > "$PID_FILE"
chmod 600 "$PID_FILE"
disown "$AMIROS_PID" 2>/dev/null || true

for _attempt in {1..45}; do
  if amiros_is_ready; then
    echo "Amiros is running in the background (process $AMIROS_PID)."
    echo "Logs: $LOG_FILE"
    open_dashboard
    exit 0
  fi
  if ! kill -0 "$AMIROS_PID" 2>/dev/null; then
    echo "Amiros stopped before the dashboard became available."
    echo "Check $LOG_FILE for details."
    read -r "?Press Return to close..."
    exit 1
  fi
  sleep 1
done

echo "Amiros is still starting. Check $LOG_FILE for progress."
read -r "?Press Return to close..."
exit 1
