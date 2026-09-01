#!/usr/bin/env bash
# Regenerates every PNG in Assets.xcassets/AppIcon.appiconset from the
# full-bleed iOS icon source (icons/icon-ios.png, 1024x1024, opaque).
#
# iOS icons differ from the desktop set on purpose: the desktop icon is a
# rounded tile floating on a transparent/white margin (macOS convention),
# while iOS wants edge-to-edge square art with NO alpha channel — App Store
# upload validation rejects a transparent large icon outright, and the
# system applies the corner mask itself. `tauri icon` regenerates all
# platforms from the desktop source, so after running it, re-run THIS script
# to restore the iOS set. Requires ImageMagick (magick).
set -euo pipefail
shopt -s extglob # the -1 duplicate-suffix strip below is an extglob pattern

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/../../icons/icon-ios.png"
SET="$HERE/Assets.xcassets/AppIcon.appiconset"
[ -f "$SRC" ] || { echo "no iOS icon source at: $SRC" >&2; exit 1; }

for png in "$SET"/AppIcon-*.png; do
  name="$(basename "$png" .png)"          # e.g. AppIcon-83.5x83.5@2x, AppIcon-512@2x
  base="${name#AppIcon-}"                 # 83.5x83.5@2x / 512@2x / 20x20@2x-1
  base="${base%-*([0-9])}"                # strip the -1 duplicate suffix
  scale="${base##*@}"; scale="${scale%x}" # 1 / 2 / 3
  points="${base%@*}"; points="${points%%x*}"
  pixels="$(python3 -c "print(round(float('$points') * int('$scale')))")"
  # PNG24: pins truecolor-no-alpha output — tiny sizes otherwise get
  # palette-encoded, which reads confusingly in audits.
  magick "$SRC" -resize "${pixels}x${pixels}" -alpha remove -alpha off "PNG24:$png"
done
magick identify -format "%f %wx%h %[channels]\n" "$SET"/AppIcon-*.png
