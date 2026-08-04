#!/bin/zsh

set -u

PROJECT_DIR="${0:A:h}"
PID_FILE="$PROJECT_DIR/work/amiros.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "No Amiros background process is recorded."
  read -r "?Press Return to close..."
  exit 0
fi

AMIROS_PID="$(<"$PID_FILE")"
if [[ ! "$AMIROS_PID" =~ '^[0-9]+$' ]]; then
  echo "The Amiros process file is invalid: $PID_FILE"
  read -r "?Press Return to close..."
  exit 1
fi

if ! kill -0 "$AMIROS_PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "Amiros was already stopped. The stale process file was removed."
  read -r "?Press Return to close..."
  exit 0
fi

echo "Stopping Amiros background process $AMIROS_PID..."
kill -TERM "$AMIROS_PID"

for _attempt in {1..20}; do
  if ! kill -0 "$AMIROS_PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "Amiros stopped."
    read -r "?Press Return to close..."
    exit 0
  fi
  sleep 1
done

echo "Amiros did not stop cleanly. Process $AMIROS_PID is still running."
echo "Its process file was kept at $PID_FILE."
read -r "?Press Return to close..."
exit 1
