# Website Screenshots

## Android Reader

`public/screenshots/android-reader-{light,dark}.png` are unmodified device
captures, not browser mockups or generated images.

- Captured: 2026-09-07.
- App: official ReadAware v0.5.4 ARM64 APK from
  <https://github.com/ahpxex/read-aware/releases/tag/v0.5.4>.
- APK SHA-256: `2cc24b57da9012479b11cf3050c36670e548e30ca2e7debd170819bfcad6bcb8`.
- Device: Pixel 7 Android 16 (API 36), ARM64 emulator, 1080 x 2400 at 420 dpi.
- Dedicated AVD: `ReadAware_Site_Screenshots`. No signed-in account or private books.
- Book: Jane Austen, *Pride and Prejudice*, Project Gutenberg no. 1342,
  <https://www.gutenberg.org/ebooks/1342.epub3.images>.
- View: Chapter I, first text page after its illustration; toolbar visible.
- Reading settings: Literata, Medium, Regular; Warm for the light capture,
  Dark for the dark capture. The system theme matches each capture.
- Android System UI demo mode fixes the clock at 10:00 and hides notifications.
  No application UI or book content was altered for the screenshots.

## Retaking

Use a separate AVD. Never uninstall or overwrite a developer's existing app
to resolve the different signing key of the release APK.

On this Mac the SDK is at `/opt/homebrew/share/android-commandlinetools`.
Launch the dedicated AVD with `-gpu host -no-snapshot`; automatic graphics
selection can fall back to software rendering and stall under memory pressure.
Keep external network requests behind the configured development proxy.

Install the official APK, push the EPUB to `/sdcard/Download/`, and import it
through the app's Android file picker. Open Chapter I from the table of
contents, swipe past the illustration, select the reading settings above,
and tap the top margin to reveal the toolbar. After changing the Android
system theme, restart the app so native status-bar colors update too.

Capture with `adb -s <dedicated-serial> exec-out screencap -p`, inspect the full
image, and replace the corresponding PNG. Preserve the complete 1080 x 2400
frame; do not retouch the UI. Shut down only the dedicated emulator afterwards.

These assets demonstrate the Android 16 app. They are not evidence of Android
12 or minimum-SDK compatibility.
