# Profile And Entity Consolidation

## Current Status

Native snapshot/conditional commit, the v34 local checkpoint, typed host service,
bounded automatic inference/idle production and evidence-validated prompt
consumption are implemented. Public inspection now uses `inspect_user_profile`
and memory 2.3 `queries.profileContext` / `events.observe(kind=profileContext)`.
The producer ports remain internal. MEM08 remains partial for resumable
large-input handling; no partial pass is labelled complete. Existing curated
profile APIs retain their meaning.

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
readers must distinguish this derived layer from the curated summary. Prompt
readers discard stale claims; explicit inspection labels retained stale content
as historical, not usable current context. Entity decisions use the
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

The first automatic producer uses one complete, revision-pinned input per pass,
not a silently truncated prefix. It reads all eligible memories and the registry
classes/members/aliases into a JSON data envelope. Input is capped at 48000 UTF-8
bytes and further constrained by the selected model window after output/framing
reserves; output is capped at 4096 tokens. Exceeding the input bound leaves the
pass pending and logs the reason. This is an explicit capacity limitation, not
evidence that a large store was processed; resumable partitioning remains work.

The strict model result contains summary, complete, resolutions and merges.
Existing resolution IDs and merge roots must occur in the captured registry;
merges require resolved roots and cannot share endpoints. New resolution IDs
are derived by code from kind, name and sorted evidence IDs, never minted by the
model. Equal names alone do not identify a person; the prompt requires explicit
evidence and conservative abstention. This deterministic proposal key prevents
duplicate retries, not a proof of real-world identity. A partial result can
commit but does not settle. Invalid/truncated/refused output cannot commit.

Existing memory decay/promotion runs first when due. The identity producer then
independently checks the durable native completion revision, even when the
ordinary memory pass has nothing to do. It uses the existing automatic-building
policy and single-flight runtime operation; reads/inference may be cancelled,
while dispatched writes drain. A failure is logged and remains eligible for a
later idle tick, never retried blindly with a freshly substituted revision.

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

The runtime now uses the production identity port under the same automatic-memory
policy as extraction/digests. Explicit inference output caps and source-tracking
options survive the policy wrapper, and its signal combines caller cancellation.
The source, validation and execution modules are separate from runtime scheduling.
Required next work: resumable bounded partitions for a store exceeding one full
input. Oversized or incomplete
model work stays pending with logged diagnostics, not a fake successful pass.
Curated profile edits win by separation and read-set conflict checks. Forgotten
or superseded evidence invalidates the derived layer before regeneration.

## Public Inspection

The shared host service reuses the `profile_context` read transaction; it does
not expose the internal producer snapshot, raw traits, source text or registry.
Agent `inspect_user_profile` is available in both scopes, including when
automatic memory building is disabled. The plugin method and observation reuse
`memory:read` (implied by write), not a new authority or an inference grant.
Curated `get_user_profile` / `queries.profile` and editing remain unchanged.

Inspection has three page kinds: `summary` (default 4000, max 16000 UTF-16 units,
never splitting a surrogate pair), `sources` (saved memory IDs/revisions and
current eligible revision, or null), and flattened `entityEvidence` pairs
(proposed event ID, memory ID). Provenance pages default to 25, at most 100 rows;
historical ID sizes and the internal full read set remain unbounded. Flattening
is paged rather than returning an unbounded nested array per event. Proposed
event IDs include no-ops; they are not mutation receipts or verified identities.

Every page reports absent/current/stale/invalid and the curated profile revision
and existence, without repeating curated text. Absent/invalid summary is null;
valid empty text is an empty string. Invalid blocks never expose raw content and
are logged. Stale well-formed content and provenance are inspectable, but cannot
be injected by the prompt selector. Current only means source-consistent, not
semantic verification or a fully settled maintenance pass. A null current source
revision means no longer eligible, not necessarily deleted. New eligible sources
also invalidate the saved complete read set, even if every old source still exists.

The `pctx1` SHA-256 token binds all page kinds to the same captured profile,
derived block and current source conditions. Continuations require it; cross-kind
reads can pin it too. Profile edits, source-only changes and equal-byte new memory
events reject old tokens rather than mixing generations. The query is copied
before initialization or scheduling. Plugin caller cancellation and retirement
reject the consumer promptly while draining its dispatched native query; Worker
RPC injects the real per-call signal, not untrusted serialized options. Observation
uses the existing serial bounded poller, with stable errors, recovery and no late
delivery to a retired actor. Inspection itself neither writes nor starts inference;
the existing one-time profile initialization remains shared host housekeeping.

Core pagination/invalidity tests, actual Agent tool/production port with scripted
IPC, plugin grants/lifecycle and fault Worker RPC tests cover these contracts.
They do not prove real Tauri, SQLite replay or model semantic correctness.

Native tests cover conflict, rollback, source/authority validation, batch limits,
replay, migration, two-connection changes and restart. Core/host tests cover
candidate copying, malformed source/authority rejection, mint ordering, partial
receipts, cancellation and failure propagation. Real AgentThread orchestration
with a scripted model checks both scopes, same-chapter prompt refresh, stale and
invalid exclusion, curated precedence and interview preservation; this is not
Tauri or model-quality evidence. Automatic producer tests cover qualification,
strict output, IDs, unknown references, disjoint merge roots, multi-page classes
and aliases, capacity refusal, conflicts and policy cancellation/drain. Runtime
tests exercise the actual HTTP adapter with scripted SSE responses and observe
the output cap, single flight, independent completion gate and runtime recreation.
The web assembly test goes through actual RuntimeDeps, inference and host minting
with scripted IPC receipts; only native tests prove SQLite transaction semantics.
Stage two adds real composition workflows; stage three
proves real Tauri/Worker/inference, revocation and cross-device replay. Native
foundations alone do not close MEM08 or count as those consumer workflows.
