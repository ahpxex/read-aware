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

The interim app_kv summary must migrate through an event exactly once, with
existing event-backed summary taking precedence. Onboarding, prompt reads,
conditional profile edits, backup/restore and observations must all move to the
same projection, not dual independent summaries. Public reads remain bounded and
writes conditional on the observed revision; entity resolve/merge additionally
need explicit memory write authorization and ownership/cancellation checks.

Stage one uses native transactional/replay tests and targeted permission/type
checks only. Formal composition plugins belong to stage two; actual Tauri,
cross-device/bootstrap, concurrent/failed/revoked operations and packaged plugin
rounds belong to stage three. Neither is replaced by projection unit tests.
