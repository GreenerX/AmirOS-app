#!/bin/zsh

set -u

PROJECT_DIR="${0:A:h}"
PID_FILE="$PROJECT_DIR/work/amiros.pid"

AMIROS_PID=""

# Prefer the watchdog PID recorded by the launcher. If that file was removed
# unexpectedly, find only the watchdog belonging to this exact AmirOS folder.
if [[ -f "$PID_FILE" ]]; then
  RECORDED_PID="$(<"$PID_FILE")"
  if [[ "$RECORDED_PID" =~ '^[0-9]+$' ]] && /bin/kill -0 "$RECORDED_PID" 2>/dev/null; then
    AMIROS_PID="$RECORDED_PID"
  else
    rm -f "$PID_FILE"
  fi
fi

if [[ -z "$AMIROS_PID" ]]; then
  for candidate in $(/usr/bin/pgrep -f "$PROJECT_DIR/scripts/amiros-watchdog.mjs" 2>/dev/null || true); do
    if [[ "$candidate" =~ '^[0-9]+$' ]] && /bin/kill -0 "$candidate" 2>/dev/null; then
      AMIROS_PID="$candidate"
      break
    fi
  done
fi

if [[ -z "$AMIROS_PID" ]]; then
  echo "AmirOS is already stopped."
  read -r "?Press Return to close..."
  exit 0
fi

echo "Stopping AmirOS background service $AMIROS_PID..."
/bin/kill -TERM "$AMIROS_PID"

for _attempt in {1..20}; do
  if ! /bin/kill -0 "$AMIROS_PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "AmirOS stopped."
    read -r "?Press Return to close..."
    exit 0
  fi
  sleep 1
done

echo "AmirOS did not stop cleanly. Process $AMIROS_PID is still running."
read -r "?Press Return to close..."
exit 1
