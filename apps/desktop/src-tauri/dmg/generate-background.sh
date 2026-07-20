#!/usr/bin/env bash
# Renders background.html to background.png (1320x876 pixels stamped as
# 144 dpi, so Finder displays it at 660x438 points, crisp on Retina).
# Requires Google Chrome and ImageMagick (magick). Run after editing
# background.html and commit the regenerated PNG.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=660,438 \
  --screenshot="$TMP/raw.png" "file://$HERE/background.html"

magick "$TMP/raw.png" -density 144 -units pixelsperinch "$HERE/background.png"
echo "wrote $HERE/background.png"
