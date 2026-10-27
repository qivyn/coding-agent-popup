#!/usr/bin/env bash
# Remove coding-agent-popup's hooks from Claude Code / Codex configs and delete ~/.coding-agent-popup.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$HOME/.coding-agent-popup/coding-agent-popup.js"

if [ -f "$TARGET" ]; then
  exec osascript -l JavaScript "$TARGET" uninstall
elif [ -f "$DIR/coding-agent-popup.js" ]; then
  exec osascript -l JavaScript "$DIR/coding-agent-popup.js" uninstall
else
  echo "coding-agent-popup.js not found (looked in ~/.coding-agent-popup and next to this script)" >&2
  exit 1
fi
