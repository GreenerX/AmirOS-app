#!/bin/sh

# macOS can refuse to spawn a Homebrew Node binary directly from a user
# LaunchAgent. Running through the system shell preserves the same local,
# user-owned process while avoiding that platform restriction.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
NODE_BIN="${AMIROS_NODE_PATH:-node}"

exec "$NODE_BIN" "$ROOT/scripts/amiros-watchdog.mjs"
