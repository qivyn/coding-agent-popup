#!/usr/bin/env bash
# agent-popup installer — copies the script to ~/.agent-popup and wires up agent hooks.
# Usage: ./install.sh [claude] [codex]     (default: whichever config dirs you already have)
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "agent-popup only works on macOS (it uses osascript + WKWebView)." >&2
  exit 1
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$DIR/agent-popup.js" ]; then
  echo "agent-popup.js not found next to install.sh" >&2
  exit 1
fi

exec osascript -l JavaScript "$DIR/agent-popup.js" install "$@"
