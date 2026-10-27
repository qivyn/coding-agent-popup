#!/usr/bin/env bash
# Remove agent-popup's hooks from Claude Code / Codex configs and delete ~/.agent-popup.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$HOME/.agent-popup/agent-popup.js"

if [ -f "$TARGET" ]; then
  exec osascript -l JavaScript "$TARGET" uninstall
elif [ -f "$DIR/agent-popup.js" ]; then
  exec osascript -l JavaScript "$DIR/agent-popup.js" uninstall
else
  echo "agent-popup.js not found (looked in ~/.agent-popup and next to this script)" >&2
  exit 1
fi
