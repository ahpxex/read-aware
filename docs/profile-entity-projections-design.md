# Profile And Entity Projections

MEM08 is not complete when event names merely exist. The stage-one closure is
durable projections plus actual host producers/readers and authorized Agent/plugin
contracts. This document fixes the data semantics before those consumers migrate.

## Deterministic State

- One `user_profile` row (`local`) belongs to the local account log, not to an
  individual device or conversation. `profile.updated` patches displayName and
  summary when present; null clears them. Traits patch top-level keys, with null
  deleting a key. Nested values are retained verbatim, not recursively inferred.
  Empty text remains distinct from absence. Omitted fields do not erase state.
- `entities` retains each resolved identity's own definition. `entity_aliases`
  retains its observed canonical names and explicit aliases, deduplicated by
  identity/name. A later resolution updates that member, never a keeper's name
  merely because the member was merged into it.
- `entity_redirects` represents identity equivalence, separately from definitions.
  Merging follows existing roots, redirects the losing root and all its members
  to the keeper root, and is a no-op for already-equivalent IDs. Therefore reverse
  or repeated merges cannot create cycles. Merges before either definition are
  retained; missing keeper definitions are reported as pending, not fabricated.
  Queries aggregate aliases across members but prefer the actual keeper's name
  and kind. No original identity/alias is destroyed by a merge.
- Existing memory entity IDs, when consumed, resolve through this identity graph;
  chapter-local digest characters are not silently treated as global identities.
  Resolution requires an explicit producer decision, never spelling alone.

## Replay And Upgrade

All projection writes remain children of storage/apply.rs and run inside the
event-log transaction. Malformed known payloads abort the whole commit, including
its outbox entry. Unknown future fields are ignored, not used as SQL or paths.
The four tables participate in rebuild, drift verification, checkpoints and wipe.
Checkpoint schema advances to 33 because an old checkpoint lacks these facts.
Checkpoint restoration clears all child tables before replacing any parent,
then inserts in reverse dependency order. Per-table delete/insert would otherwise
cascade away the aliases restored just before their entity definitions.

Migration 33 projects only historical profile/entity events in canonical HLC
order, without rebuilding unrelated legacy rows. On an incomplete bootstrap log,
mark projections stale and leave completion to the existing backfill/replay path;
do not publish a new complete checkpoint from that partial history. A failed
historical event rolls back the migration rather than marking it applied.

## Remaining Consumer Work

### Summary Migration Contract

Native `profile_initialize`, `profile_inspect`, `profile_commit` and
`profile_restore` now implement the transaction side below. They are registered
internal IPC commands, not new plugin/model authority. Startup now invokes
initialization, removes the legacy settings mirror and logs migration failure;
profile operations retry initialization rather than reading a stale KV fallback.
ProfilePort, prompt assembly, onboarding, public pages/edits/observations and v1
backup summary handling now share this projection through memory domain 2.

The host initializes the summary with a system-origin event envelope minted by
the existing frontend HLC service. Native code supplies the actual durable KV
value inside the same transaction that deletes the legacy key. A prior summary
event, including an explicit null clear, takes precedence; displayName-only
events do not prevent importing the old summary. Incomplete/stale history cannot
decide this precedence. Initialization retries after failure and never publishes
a second independently writable summary cache.

Profile revisions become `profile2:` hashes of `[summary, lastProfileEventId]`.
Native writes compare the observed revision inside an immediate transaction;
an A-to-B-to-A change invalidates an old decision. Normal edits remain limited
to 16000 UTF-16 units. Internal v1 backup restore preserves larger historical
summaries through a separate host-only restore entry, not an actor override flag.
Both use profile.updated and reject stale event clocks before committing.
Memory domain 2 records the persistence contract as event-log, not device-local.

The native reader refuses unretired legacy KV or stale projections instead of
reporting an empty summary. Commit requires a fresh local-device envelope after
the entire log/checkpoint frontier and rejects duplicate IDs. Equal text is a
no-op only after the observed revision and envelope pass validation. Origin is
provenance, not authorization: the host must keep restore/initialization outside
the Agent/plugin bridge and retain existing grants for normal profile edits.

The v1 backup wire format remains the same subset: export materializes the
current summary under its historical KV key, import removes that key from raw
KV restoration and conditionally writes the profile event instead. This does
not turn v1 into a full profile/entity/event-log backup or a context bundle.
An absent historical key leaves the current summary alone; an empty string
restores an intentionally empty summary. The archive observes the current
revision before restoring other KV, then submits it to conditional profile
restore. Conflicts fail visibly; earlier sequential archive writes do not roll
back. Normal onboarding takes a fresh snapshot and uses the same conditional
summary write; its subsequent memory seeds remain separate transactions.

Public reads remain bounded and writes conditional on the observed revision.
The existing Memory Desk consumer now requires memory 2; this is a coordinated
breaking contract, not an adapter that silently accepts profile1 decisions.
Entity resolve/merge still need bounded read/conditional write APIs with explicit
memory authorization and ownership/cancellation checks. Full interview/seed
orchestration and consolidation are not implemented by summary migration.

Stage one uses native transactional/replay tests and targeted permission/type
checks only. Formal composition plugins belong to stage two; actual Tauri,
cross-device/bootstrap, concurrent/failed/revoked operations and packaged plugin
rounds belong to stage three. Neither is replaced by projection unit tests.
