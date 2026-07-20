#!/usr/bin/env bash
# Injects "READ ME.txt" (Gatekeeper help) into a Tauri-built DMG and
# re-compresses it in place. Tauri's bundler cannot add extra files to the
# DMG, so this runs as a post-step (locally or in release.yml) after
# `tauri build` produced the .dmg. The icon position must stay in sync with
# the bottom-right area reserved in background.html. Geometry: the Finder
# window bounds include the ~32pt title bar; tauri.conf.json sets windowSize
# height to 471 so the 438pt background fits the ~439pt viewport. Finder also
# extends the scrollable extent to <icon position> + <icon cell>, so the icon
# must sit at {520, 300} or higher-left — {560, 332} made the window scroll
# (extent 675x460 vs the 660x439 viewport, verified via accessibility).
# Usage: finalize-dmg.sh <path-to.dmg>
set -euo pipefail

DMG="$1"
[ -f "$DMG" ] || { echo "no dmg at: $DMG" >&2; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOTES="READ ME.txt"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

hdiutil convert "$DMG" -format UDRW -o "$WORK/rw.dmg" -quiet
ATTACH="$(hdiutil attach "$WORK/rw.dmg" -readwrite -noverify -noautoopen)"
DEV="$(echo "$ATTACH" | awk 'NR==1 {print $1}')"
MOUNT="$(echo "$ATTACH" | grep -o "/Volumes/.*" | head -1)"
VOL="$(basename "$MOUNT")"

cp "$HERE/$NOTES" "$MOUNT/$NOTES"

osascript <<EOF
tell application "Finder"
  tell disk "$VOL"
    open
    set position of item "$NOTES" to {520, 300}
    update without registering applications
    delay 1
    close
  end tell
end tell
EOF
sync

for _ in 1 2 3 4 5; do
  hdiutil detach "$DEV" -quiet && break
  sleep 2
done

hdiutil convert "$WORK/rw.dmg" -format UDZO -imagekey zlib-level=9 -o "$WORK/final.dmg" -quiet
mv "$WORK/final.dmg" "$DMG"
echo "finalized $DMG"
