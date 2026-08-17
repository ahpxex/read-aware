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
- The webview logs through the seam in `apps/web/src/platform/logger.ts`
  (`createLogger("<module>")`): console in dev, forwarded into the same file
  inside Tauri. Uncaught errors / unhandled rejections are captured by
  `platform/global-error-log.ts`; a failed boot paints `src/boot-failure.ts`
  instead of hanging on the splash.
- **Rule:** log messages carry ids and error text, never book content, notes,
  or conversation text. The bundle must stay safe to share.

## 2. The bundle

`apps/web/src/features/settings/lib/diagnostics.ts` assembles: app version,
platform, locale/user-agent, the tail of the log files (≤ 256 KiB, via the
`diagnostics_read_logs` command), and the `verify_projections` self-check
(event log ⇄ projection drift). Export writes it as
`readaware-diagnostics-<date>.json`.

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
