# Diagnostics & logging

How a production failure leaves a trace, and how it reaches the developer.
Three layers, strictly opt-in past the first:

1. **Local file log** — always on, never leaves the device.
2. **Diagnostics bundle** — assembled on demand in Settings → About →
   Diagnostics; the user can export it to a file.
3. **User-initiated report** — the same bundle POSTed to the relay, behind a
   preview-and-confirm dialog. The app never uploads anything on its own.

## 1. The file log

- Written by `tauri-plugin-log` (`build_log_plugin` in
  `apps/desktop/src-tauri/src/lib.rs`) into the OS log dir
  (`~/Library/Logs/<bundle-id>/` on macOS, `%APPDATA%` on Windows,
  `~/.config/<bundle-id>/` on Linux) as `readaware.log`, rotating at ~5 MB
  with 4 files kept.
- Level: `Info` in release, `Debug` in dev. Rust panics are captured by a
  panic hook (`install_panic_log_hook`) — message, location, backtrace.
- Line format: `[2026-11-18][16:10:44-05:00][LEVEL][target] message`. The
  time is the device's wall clock with its UTC offset (`log_timestamp`); a
  device whose local offset cannot be read logs UTC as `+00:00`.
- A logged error renders its stack and its `cause` chain, two links deep,
  each with its stack. A failed JNI call into `MainActivity` logs the Java
  exception's `toString()` (`android_jni::take_failure`).
- The webview logs through the seam in `apps/web/src/platform/logger.ts`
  (`createLogger("<module>")`): console in dev, forwarded into the same file
  inside Tauri. Uncaught errors / unhandled rejections are captured by
  `platform/global-error-log.ts`; a failed boot paints `src/boot-failure.ts`
  instead of hanging on the splash.
- **Rule:** log messages carry ids and error text, never book content, notes,
  or conversation text. The bundle must stay safe to share.
- Every webview line is made safe in `renderLine`, whoever logs it, since
  error text is not always ours (plugins name methods and write messages and
  stacks; failed requests name URLs):
  - the line is capped at 4000 characters, then redacted;
  - URLs are parsed (WHATWG) and lose userinfo, query and fragment; a path
    that may hide credentials (an `@`, a leading `//`, encoded quotes, a
    nested scheme) keeps only scheme and host, and text that does not parse
    keeps only its scheme;
  - continuation lines are indented, so no text can pose as a log line
    (which starts at column 0).

### Plugin failures

Every plugin failure names its plugin as `id@version`:

- A host call a plugin makes that fails (a service it invoked threw) is
  logged at the Worker boundary as `Plugin host call failed · <plugin> ·
  <method> · <host error with stack>`, once per distinct failure per Worker,
  at most 32 per Worker for network requests and 32 for every other host
  call; cancellations are not logged.
- A failure the Worker reports back (an action, service or migration it ran)
  is rebuilt on the host with its own message and code, and carries
  `caused by PluginWorker: thrown in plugin <plugin>` plus the Worker's
  stack (bounded to 4 KiB, every line indented) as its cause.

## 2. The bundle

`apps/web/src/features/settings/lib/diagnostics.ts` assembles:

- `appVersion`, `platform`, `userAgent`, `language`;
- `build`: the frontend's `commit` (`-dirty` for a build from a worktree
  with uncommitted changes) and Vite `mode`;
- `environment` (`diagnostics_environment`, `os_facts.rs`): the native
  `buildProfile` (`release` builds are minified; Android release builds run
  R8, so a dev build passing proves nothing about them), OS version and
  build from the platform (the user agent freezes desktop versions), and on
  Android the SDK level, maker, model and the raw
  `hw_sc.build.platform.version` property (HarmonyOS 2–4; unverified);
- `timeZone` and `utcOffsetMinutes` when the bundle was made;
- `plugins`: every installed plugin's id, version, enabled state, source
  and, for one that is not running, its failure code;
- the tail of the log files (≤ 256 KiB, via `diagnostics_read_logs`);
- the `verify_projections` self-check (event log ⇄ projection drift).

Export writes it as `readaware-diagnostics-<date>.json`.

## 3. Reports on the relay

`POST /v1/report` (unauthenticated; size-capped at 512 KiB, per-IP throttled,
write-only). Payload lands in R2 as `_reports/<uuid>.json`; a metadata row
lands in D1 `diagnostic_reports`. The user gets the uuid back as a receipt id
to quote in support conversations.

### Reading reports (operator)

From `apps/relay/`:

```sh
# List recent reports (newest first)
bunx wrangler d1 execute read-aware-relay --remote --command \
  "SELECT id, created_at, app_version, platform, bytes FROM diagnostic_reports ORDER BY created_at_ms DESC LIMIT 20"

# Fetch one report's payload
bunx wrangler r2 object get read-aware-relay-blobs/_reports/<id>.json --file /tmp/report.json --remote
```

Deploying the endpoint needs the D1 migration applied once:

```sh
bunx wrangler d1 migrations apply read-aware-relay --remote
```

## 4. Source maps

Production frontend builds write hidden source maps and move them out of
`apps/web/dist/` into `apps/web/sourcemaps/` (git-ignored) before the shell
bundles `dist/` (`apps/web/build/archive-sourcemaps.ts`). The build fails if a
map, or a `sourceMappingURL` in the bundler's output, would ship; plugin
builds (`scripts/build-plugin.ts`) fail the same way. Plugin bundles are not
minified and need no maps.

Each release job attaches its archive as
`ReadAware-vX.Y.Z-<platform>-<arch>-sourcemaps.zip`; the App Store build
keeps a 90-day `sourcemaps-ios-appstore-vX.Y.Z` Actions artifact. Asset file
names are content hashes and frontend builds are reproducible (rebuilding
v0.6.11 locally gave the Android release's exact hashes), so a frame's file
name selects its map; `build.json` records the commit as a cross-check.

To map a bundle's stack frames back to source:

```sh
bun scripts/symbolicate-diagnostics.ts readaware-diagnostics-2026-11-18.json --out /tmp/mapped.txt
```

Without `--maps` it downloads the release's archives for the bundle's
version and platform with `gh`. A release older than the archives (v0.6.11
and before) can be rebuilt: in a worktree at its tag, add
`build: { sourcemap: "hidden" }` to `apps/web/vite.config.ts`, run
`bun run --filter @read-aware/desktop build:frontend`, and pass
`--maps apps/web/dist` from that worktree. Frames whose asset has no map are
listed, never guessed.
