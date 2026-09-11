# Desktop Startup Setting

SET04 owns one device-local, app-identifier-scoped startup registration. The
settings catalog, Agent and plugin path policies stay the public API. No Worker
receives autostart IPC permission or executable/path arguments.

## Commit Boundary

- All KV set, batch, delete and prefix replacement commands use the same SQLite
  mutex. If the general-settings record is affected, parse its strict boolean,
  read native registration, apply and verify it, then commit SQLite.
- Compensate an OS change if either verification or SQLite fails. If compensation
  also fails, reject and log both errors; never claim cross-system atomicity.
- Read status under the same mutex. UI and domain reads use registration status,
  not the old inert stored boolean. Patch other general fields against that
  status so a language change cannot resurrect a stale startup preference.
- A queued actor abort is checked again after the asynchronous native read,
  before persistence. Already dispatched native writes are not falsely cancelled.
- UI submits field intents through the domain. Loading/error status is not an
  unchecked successful read. Commit/focus refreshes discard obsolete results;
  failed writes retain a destructive toast and refresh registration status.

## Dependency Boundary

Use tauri-plugin-autostart's Rust manager with the application identifier, not
the shared product name. An audited Cargo patch to auto-launch corrects its
startup-entry serialization: structured macOS plist, quoted Windows executable,
and escaped Linux Exec arguments. Pure serialization tests must not install real
startup entries. Retain upstream license, origin and patch notes.

The reported boolean describes the application's registration, not a promise
that OS policy will permit the next login launch. Real login, packaged paths,
external OS controls, native failure injection and isolated plugin workflows
belong to stage three; no desktop execution in stage one.
