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

# Prefer Chromium / Chrome for Testing (branded Chrome 137+ removed --load-extension)
CHROME_BIN="${CHROME_BIN:-}"
if [[ -z "$CHROME_BIN" ]]; then
  for candidate in \
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "$(command -v chromium 2>/dev/null || true)" \
    "$(command -v chromium-browser 2>/dev/null || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      CHROME_BIN="$candidate"
      break
    fi
  done
fi

if [[ -z "$CHROME_BIN" ]] && command -v node >/dev/null 2>&1; then
  PUPPETEER_CHROME="$(node -e "(async()=>{try{const p=require('puppeteer');const e=typeof p.executablePath==='function'?await p.executablePath():'';if(e)process.stdout.write(e);}catch(_){}})()" 2>/dev/null || true)"
  if [[ -n "$PUPPETEER_CHROME" && -x "$PUPPETEER_CHROME" ]]; then
    CHROME_BIN="$PUPPETEER_CHROME"
  fi
fi

if [[ -z "$CHROME_BIN" ]]; then
  CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  if [[ ! -x "$CHROME_BIN" ]] && command -v google-chrome >/dev/null 2>&1; then
    CHROME_BIN="$(command -v google-chrome)"
  fi
  if [[ -x "$CHROME_BIN" ]]; then
    echo "Warning: Falling back to branded Chrome ($CHROME_BIN). Chrome 137+ ignores --load-extension; install Chromium/Chrome for Testing or set CHROME_BIN." >&2
  fi
fi

if [[ ! -x "$CHROME_BIN" ]]; then
  echo "Error: No Chromium or Chrome executable found. Set CHROME_BIN to a Chromium/Chrome for Testing binary." >&2
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
