#!/usr/bin/env bash
# tools/test-local.sh — Launch Chrome with CineGlow Pro v3.0.0 unpacked in an isolated profile

set -euo pipefail

readonly DEFAULT_TARGET_URL="https://www.youtube.com"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly EXT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<EOF
Usage: $(basename "$0") [TARGET_URL]

Launch Google Chrome with CineGlow Pro loaded unpacked from $EXT_DIR
in an isolated temporary profile directory.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

readonly TARGET_URL="${1:-$DEFAULT_TARGET_URL}"
PROFILE_DIR="${PROFILE_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/chrome-cineglow-local-profile.XXXXXX")}"

cleanup() {
  rm -rf -- "$PROFILE_DIR"
}
trap cleanup EXIT INT TERM

CHROME_BIN="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [[ ! -x "$CHROME_BIN" ]] && command -v google-chrome >/dev/null 2>&1; then
  CHROME_BIN="$(command -v google-chrome)"
fi

if [[ ! -x "$CHROME_BIN" ]]; then
  echo "Error: Google Chrome executable not found or not executable at $CHROME_BIN" >&2
  exit 1
fi

if [[ ! -f "$EXT_DIR/manifest.json" ]]; then
  echo "Error: manifest.json not found in $EXT_DIR" >&2
  exit 1
fi

echo "================================================================="
echo "   CineGlow Pro v3.0.0 — Local Development Test Launcher         "
echo "================================================================="
echo "Extension Root: $EXT_DIR"
echo "Profile Dir:    $PROFILE_DIR"
echo "Target URL:     $TARGET_URL"
echo "-----------------------------------------------------------------"
echo "Starting Chrome instance..."

"$CHROME_BIN" \
  --load-extension="$EXT_DIR" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  "$TARGET_URL"
