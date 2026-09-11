# Profile And Entity Consolidation

## Current Status

Native snapshot/conditional commit, the v34 local checkpoint, typed host service
and evidence-validated prompt consumption are implemented. These are internal
ports, not new model or plugin methods. The automatic inference/idle producer
below is still required; MEM08 remains partial. No automatic inference starts
from these bindings alone. Existing curated profile APIs retain their meaning.

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

Prompt reads use a dedicated read transaction over curated profile, the derived
block and its current eligible memory set. They must not hash or load the entity
registry on every chat turn. With no derived block, no evidence scan is needed.
Only source IDs/revisions cross this prompt IPC, not the memory contents.
The TypeScript selector validates the versioned block and exact source revisions;
missing, changed or newly eligible evidence drops generated context before any
replacement is ready. Invalid historical blocks are omitted with a warning.
Curated retrieval/editing stays separate, and an inferred profile does not count
as completing the user's onboarding interview.

The host service copies and validates the plan before any asynchronous work.
Each entity decision must name the snapshot's registry revision. The host mints
entity event IDs/HLCs, then the profile envelope with their evidence links; the
model cannot select origins, event IDs or HLCs. It checks cancellation after
initialization and each mint, before dispatch. Dispatched transactions return
their actual receipt or error and broadcast only the receipt's emitted events.
No conflict is automatically retried with a replacement version.

Required next bindings: model-facing bounded input assembly and strict structured
output with source attribution, stable entity-ID ownership, automatic runtime
ports, live-policy cancellation/drain and durable idle skip. Oversized or incomplete
model work stays pending with logged diagnostics, not a fake successful pass.
Curated profile edits win by separation and read-set conflict checks. Forgotten
or superseded evidence invalidates the derived layer before regeneration.

Native tests cover conflict, rollback, source/authority validation, batch limits,
replay, migration, two-connection changes and restart. Core/host tests cover
candidate copying, malformed source/authority rejection, mint ordering, partial
receipts, cancellation and failure propagation. Real AgentThread orchestration
with a scripted model checks both scopes, same-chapter prompt refresh, stale and
invalid exclusion, curated precedence and interview preservation; this is not
Tauri or model-quality evidence. Automatic producer/policy tests remain required.
Stage two adds real composition workflows; stage three
proves real Tauri/Worker/inference, revocation and cross-device replay. Native
foundations alone do not close MEM08 or count as those consumer workflows.
