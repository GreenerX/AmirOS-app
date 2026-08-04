#!/bin/zsh

set -u

PROJECT_DIR="${0:A:h}"
PID_FILE="$PROJECT_DIR/work/amiros.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "AmirOS is already stopped."
  read -r "?Press Return to close..."
  exit 0
fi

AMIROS_PID="$(<"$PID_FILE")"
if [[ ! "$AMIROS_PID" =~ '^[0-9]+$' ]]; then
  echo "The AmirOS process file is invalid: $PID_FILE"
  read -r "?Press Return to close..."
  exit 1
fi

if ! /bin/kill -0 "-$AMIROS_PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "AmirOS was already stopped."
  read -r "?Press Return to close..."
  exit 0
fi

echo "Stopping AmirOS background process $AMIROS_PID..."
/bin/kill -TERM "-$AMIROS_PID"

for _attempt in {1..20}; do
  if ! /bin/kill -0 "-$AMIROS_PID" 2>/dev/null; then
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
