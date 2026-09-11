# File Associations

SET05 has two separate responsibilities: OS handler registration and acceptance
of files delivered by that handler. Both must be real before the matrix row can
leave partial. This design does not change the three-stage delivery goal.

## Intake Boundary

- Cold argv, second-instance argv and macOS RunEvent::Opened share one native
  queue. It starts with unknown policy until SQLite preferences are read. No
  unknown/failed read is treated as an empty successful queue.
- A general-preferences commit validates both OS-related booleans. Startup
  registration is applied before SQLite as before. The queue policy is published
  with the durable general-record change, never by a later frontend effect.
- Closing intake clears parked files and changes the batch epoch. Reopening does
  not replay dropped files. Failed saves leave the old policy and queue intact.
- The host checks a drained batch's epoch after file-size preparation and again
  before requesting navigation. Native staging also checks the epoch before any
  import work: a revoke between the frontend check and native dispatch cannot
  admit another import. Admission is the start boundary; an admitted import may
  finish, and disabling is not claimed to roll back its writes or navigation
  already dispatched by the frontend.
- DB then queue is the only nested lock order. No queue lock is held across OS
  startup registration work. Native intake failures use CommandError and logging.
- Manual file picking, drag/drop and readaware:// authentication are separate
  user actions, not gated by this setting.

## Platform Registration

- macOS: bundled Info.plist association remains. Toggle only accepts/rejects file
  deliveries; copy must say that macOS association itself is not removed.
- Windows: register/unregister application-owned per-user ProgIDs and
  OpenWithProgids, notify the shell, never edit protected UserChoice or delete
  another application's extension/default data. Default app choice remains OS UI.
- Linux: register/unregister owned desktop/MIME artifacts using user-mode xdg
  tools. Verify results and preserve other handlers/default choices. Account for
  packaged desktop IDs and upgrades so disabling cannot leave a second active
  registration behind. Missing tools/failed commands must reject, not save success.
- Windows/Linux registration and packaging ownership need their own targeted
  tests. Until connected, SET05 stays partial with that explicit closure condition;
  intake gating is not represented as equivalent to registration/unregistration.

Stage one uses native pure/SQLite tests and controlled IPC only. Stage three must
exercise real cold/warm file opens, enable/disable/re-enable, in-flight revocation,
failure/rollback, isolated identifiers, installed packages and platform handlers.
