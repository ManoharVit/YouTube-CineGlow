#!/usr/bin/env bash
# tools/test-local.sh — Launch Chrome with CineGlow Pro v2.4.0 unpacked in an isolated profile

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROFILE_DIR="/tmp/chrome-cineglow-local-profile"

CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [[ ! -f "$CHROME_BIN" ]]; then
  echo "Error: Google Chrome not found at $CHROME_BIN" >&2
  exit 1
fi

echo "================================================================="
echo "   CineGlow Pro v2.4.0 — Local Development Test Launcher         "
echo "================================================================="
echo "Extension Root: $EXT_DIR"
echo "Profile Dir:    $PROFILE_DIR"
echo "Target URL:     https://www.youtube.com"
echo "-----------------------------------------------------------------"
echo "Starting Chrome instance..."

exec "$CHROME_BIN" \
  --load-extension="$EXT_DIR" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  "https://www.youtube.com"
