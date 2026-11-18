# Website Screenshots

## Desktop Plates

`public/screenshots/{shelf,reader,context,plugins}-{light,dark}.webp` are
unretouched captures of the desktop app's webview, 1200 x 800 at 2x. Each
light/dark pair is one staged view captured twice, with only the theme changed
in between. `public/og.jpg` is cut from the light shelf.

- Captured: 2026-11-18, from the v0.6.11 source running as a development build
  on macOS.
- Library: a profile made for the captures, holding 25 public-domain EPUBs from
  Project Gutenberg in English, French, German, Spanish, Italian, Chinese and
  Japanese, and one collection, "Russian novels". No account, no sync, no
  private books or notes.
- Shelf: default sort, scrolled to the top.
- Reader: *Pride and Prejudice* (Gutenberg no. 1342), Chapter I, continuous
  scroll, Literata, Sentence Reader on the opening sentence. Page theme Warm
  for the light capture and Dark for the dark one.
- Context: one real conversation on the Agent page, asked once and not edited:
  "Look across my whole shelf. What threads run through the books I keep?"
- Plugins: Settings → Plugins on a fresh profile, built-in plugins only.

### Retaking

Capture from a profile of its own, never from a personal library: the plates
are public. A development build can run under a separate identity beside the
ordinary one, with its own data directory, when it is started with
`READAWARE_ACCEPTANCE_IDENTITY=com.readaware.app.<name>` and a Tauri config
that sets the same `identifier`, a `productName` that does not start with
"ReadAware Dev", and its own `devUrl` port (see
`apps/desktop/src-tauri/tauri.capability-e2e.conf.json` for the shape). Fill
the library with `ra --data-dir <profile> import <files>`; the shelf lists the
most recently added book first.

The webview stops animating while its window is fully covered, so surfaces
that fade in come out blank. Keep the window on screen while capturing, without
giving it keyboard focus: a capture session that takes focus also takes
whatever is being typed elsewhere.

Encode with `cwebp -q 84 -m 6 -sharp_yuv`, keep the 2400 x 1600 frame, and bump
`SHOT_VERSION` in `src/components/Plate.tsx` together with the two preload URLs
in `scripts/prerender.mjs`. Check every image for anything private before
committing it.

## Android Reader

`public/screenshots/android-reader-{light,dark}.png` are unmodified device
captures, not browser mockups or generated images.

- Captured: 2026-11-18.
- App: official ReadAware v0.6.11 ARM64 APK from
  <https://github.com/ahpxex/read-aware/releases/tag/v0.6.11>.
- APK SHA-256: `96dc099f0ebae070deeca8777c03aac48c2bc7e1e010b1a733201fe10746b829`.
- Device: Pixel 7 Android 16 (API 36), ARM64 emulator, 1080 x 2400 at 420 dpi.
- Dedicated AVD: `ReadAware_Site_Screenshots`. No signed-in account or private books.
- Book: Jane Austen, *Pride and Prejudice*, Project Gutenberg no. 1342,
  <https://www.gutenberg.org/ebooks/1342.epub3.images>.
- View: Chapter I, first text page after its illustration; toolbar visible.
- Reading settings: Literata, Medium, Regular; Warm for the light capture,
  Dark for the dark capture. The system theme matches each capture.
- Android System UI demo mode fixes the clock at 10:00, shows full Wi-Fi and
  battery, and hides notifications. The device clock itself is set to 10:00
  as well, because the reader's own footer shows the time.
  No application UI or book content was altered for the screenshots.

## Retaking

Use a separate AVD. Never uninstall or overwrite a developer's existing app
to resolve the different signing key of the release APK.

The dedicated AVD is not kept between captures: it shares the development
AVD's system image, so it takes a minute to create and only costs disk while
idle. Create it for the session and delete it afterwards:

```sh
avdmanager create avd -n ReadAware_Site_Screenshots \
  -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_7
avdmanager delete avd -n ReadAware_Site_Screenshots
```

On this Mac the SDK is at `/opt/homebrew/share/android-commandlinetools`.
Launch the dedicated AVD with `-gpu host -no-snapshot`; automatic graphics
selection can fall back to software rendering and stall under memory pressure.
`-no-window -port 5556` runs it out of sight beside a development emulator on
the default port.

Install the official APK, push the EPUB to `/sdcard/Download/`, and import it
through the app's Android file picker. Open Chapter I from the table of
contents, swipe past the illustration, select the reading settings above,
and tap the top margin to reveal the toolbar. After changing the Android
system theme, restart the app so native status-bar colors update too, then go
to the same page again: do not count on the restart reopening the book where
it was.

Capture with `adb -s <dedicated-serial> exec-out screencap -p`, inspect the full
image, and replace the corresponding PNG. Preserve the complete 1080 x 2400
frame; do not retouch the UI. Shut down only the dedicated emulator afterwards.

These assets demonstrate the Android 16 app. They are not evidence of Android
12 or minimum-SDK compatibility.
