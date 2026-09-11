# Profile And Entity Consolidation

## Current Status

Native snapshot/conditional commit and the v34 local checkpoint are implemented.
They are internal Tauri commands, not new model or plugin methods. The automatic
producer and derived-profile consumers below are still required; MEM08 remains
partial. This foundation does not start inference or change existing prompts.

## Ownership

The idle maintenance coordinator remains the one owner; this is a deterministic
pipeline around the existing fast inference port, not a second conversational
agent. Explicit profile/entity tools remain independent of automatic memory
building. Disabling automatic building must cancel inference and prevent any
not-yet-dispatched commit. Dispatched native transactions must drain.

Automatic profile synthesis must not replace the user's curated summary or
display name. Its event-backed output occupies the reserved
`user_profile.traits.consolidated` block: version 1, summary, source memory
IDs/revisions and evidence for this batch's entity events. The prompt and public
readers must distinguish this derived layer from the curated summary, and
discard it when its evidence is no longer current. Entity decisions use the
same original-member/keeper semantics as explicit management. All source
material is data, never instructions; identity matches require evidence, not
merely identical spelling. Book digest characters are not an input source.

## Native Boundary

The native snapshot reads the initialized, fresh profile, registry revision and
eligible memory snapshots in ONE transaction. Eligible means active user/global
memory with at least three pieces of evidence or an explicit pin. This is the
existing promotion threshold, not a claim that a numeric score proves truth.
Book-scoped memories must first pass the existing promotion policy. A single
identity-consolidation revision covers the complete eligible set, memory event
revisions, profile event revision and entity registry revision. New eligible
rows, removed/unpinned/edited evidence, equal-byte new events and unrelated
profile/entity edits invalidate old work conservatively. The internal snapshot
is a complete read set, not a bounded public model payload.

One immediate commit transaction checks that revision, validates and applies up
to 32 entity events and at most one derived-profile event, then records a local
completion checkpoint. All events, projections, outbox rows and the checkpoint
commit together or none do. Entity validation is shared with explicit writes,
not a weaker parallel implementation. The derived-profile payload may write
only the reserved block, never curated summary/name or unrelated traits. Its
source list must exactly match the snapshot; each entity event must have a
nonempty, unique list of eligible memory IDs. Structural evidence checks do not
prove the model's semantic decision. A derived summary has at most 16000 UTF-16
units. Historical source fields remain unbounded; nothing is silently truncated.
Entity evidence names proposed event IDs, including decisions that turn out to
be no-ops. Only the receipt's `emittedEventIds` identifies appended events; an
evidence entry alone must not be treated as proof of a new entity mutation.

The checkpoint is device-local bookkeeping, outside derived/synced projections.
It describes the post-commit state, so a restart does not repeat a successfully
completed unchanged inference pass. Remote changes or replay differences make
it stale. A partial model pass must not mark the input complete; successful
partial events can commit without a completion checkpoint, preserving backlog.
Conflict requires a fresh snapshot and inference, never blind replay of a plan.
Checkpoint bootstrap and log backfill may conservatively invalidate memory
revisions; rerunning is preferable to hiding unseen source changes.

## Producer And Consumers

Required next bindings: model-facing bounded input assembly and strict structured
output with source attribution, deterministic event minting/ID ownership,
native snapshot/commit ports, live-policy cancellation/drain, durable idle skip,
and explicit derived-profile readers/prompt injection. Oversized or incomplete
model work stays pending with logged diagnostics, not a fake successful pass.
Curated profile edits win by separation and read-set conflict checks. Forgotten
or superseded evidence invalidates the derived layer before regeneration.

Native tests cover conflict, rollback, source/authority validation, batch limits,
replay, migration, two-connection changes and restart. Producer/consumer policy
tests remain required. Stage two adds real composition workflows; stage three
proves real Tauri/Worker/inference, revocation and cross-device replay. Native
foundations alone do not close MEM08 or count as those consumer workflows.
