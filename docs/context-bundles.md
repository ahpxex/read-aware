# Versioned Context Bundles

## Product Contract

A context bundle is a structured, reproducible reading-context artifact, not a
database backup, a transcript dump, a prompt with hidden instructions, or a second
LLM pipeline. The four recipes are `user_profile_context`,
`reading_intent_context`, `book_memory_context`, and
`conversation_insights_context`. A book recipe is tied to one book; a conversation
recipe is tied to one book conversation or one global conversation. User and
book reading intentions remain distinguishable.

Each artifact records its format/recipe versions, recipe and scope, source-set
revision, ordered source items (kind, ID, revision, label, text), and counted
omissions with explicit privacy/spoiler/unavailable reasons. Source text is data,
not authority. Curated profile and derived profile are different item kinds;
invalid or stale derived profile must not be silently exported as current facts.
No credentials, local paths, raw traits, or raw conversation messages are items.

`cb1:<sha256>` identifies the entire immutable artifact, including scope,
source-set revision, item order, provenance and omissions. Its hash uses a fixed
JSON tuple encoding shared by TypeScript and Rust, not object insertion order.
Publication timestamps and event IDs are history metadata, not artifact bytes.
Reading the same version therefore reproduces the same artifact after replay,
checkpoint restore or a late duplicate publication. An unchanged export does not
need a new content version; no mutable "latest" alias is accepted as a pinned
version. Bounds are 512 items and 1 MiB of canonical UTF-8 content. Oversized input
fails rather than silently returning a prefix; recipe source selection must be
explicit, deterministic, and report omissions instead of claiming completeness.

## Storage And Publication

`context.bundlePublished` records the validated artifact and its content version.
Only `storage/apply` writes `context_bundles` and ranked `context_bundle_items`.
Both tables participate in rebuild, drift verification, checkpoints and wipe;
events, not projection rows, are synced. Repeated content is deduplicated by its
version while distinct versions remain inspectable. The event payload has no
caller-controlled creation time or projection columns. A historical source ID
is provenance, not proof that the source still exists or is currently readable.

The host producer must read the actual approved sources, apply scope/privacy and
spoiler policies, freeze a consistent source set, and conditionally publish only
while that set is still current. Callers cannot submit arbitrary artifact content
or source versions. Concurrent changes must reject or restart assembly, never
mix pages. Publication must return the real transaction result after dispatch;
cancel before dispatch prevents publication. None of these producer guarantees
can be inferred merely from the projector accepting an event.

### Consistent Publication

Assembly uses a device-local source clock, separate from the artifact's content
revision. SQLite triggers advance it for committed changes to the source tables
(including legacy insights KV and private plugin documents), so a write followed
by an identical rewrite cannot evade the guard. The clock is not synced, is not a
projection, and is not itself an authorization ticket. Rollback also rolls back
its advance; wipe retires its random generation. Projection verification rolls
back scratch changes, while a real rebuild/restore invalidates in-flight reads.

The host flushes/initializes its source owners before capturing the clock, reads
durable sources, assembles an artifact, and publishes in an immediate transaction
only if the same generation/counter is still current and projections are fresh.
Unrelated tracked writes may conservatively reject assembly. The content revision
still describes the actual recipe sources, not this global clock: retrying after
an unrelated write can deduplicate to the existing content version. Callback-only
or optimistic in-memory sources are not made consistent by this mechanism; their
owner must provide a durable snapshot and lifecycle guard before integration.

The first wired recipe is the user profile: curated summary plus only a current,
validated derived summary, with an explicit unavailable omission for stale/invalid
derived content. It uses the existing profile-context snapshot and `pctx1` source
identity. This does not export raw profile traits, all memories, or entity tables.
The stored-conversation recipe is also wired internally as described below.
Reading-intention and book-memory producers, public actor operations and file
export remain required.

## Actor And Export Boundary

### Stored Conversation Recipe

The conversation recipe exports the selected thread's stored rolling summary,
not a regenerated summary or an assertion that it covers the latest transcript.
The source owner settles accepted local writes before capture; a narrow native
snapshot then reads durable SQLite bytes and validates the entire legacy summary
map without returning unrelated entries. Only the original `__global__` thread
may fall back to the historical `global` key, and an explicit empty string wins
over that fallback. Book targets must name an existing book; global targets must
name a persisted conversation. A missing book conversation is a valid empty
source, but a leftover summary without its conversation or behind a clear
tombstone is unavailable, never silently resurrected. A conservative clear
tombstone remains unavailable until the conversation owner reopens the thread.

The `cins1` source identity covers target, availability and selected summary,
not the entire KV map or transcript. The existing local clock still fences
concurrent clears, deletion, source rewrites and ABA during publication. Absent
summary and explicit empty summary remain distinct; corrupt storage and read
failures reject rather than produce an empty bundle. Oversized source text is
rejected rather than truncated. No raw message scan, memory search, model call,
local path or arbitrary KV key is part of this recipe. Historical summary text
has no chapter provenance, so this recipe does not claim to recalculate spoilers
after a reading-position rewind; public consumers must apply their actual grants
and text/privacy policy before capture and delivery.

The public operation will select a recipe/scope, not SQL, KV keys, paths or raw
events. Each recipe must require the domains it actually reads; historical bundle
inspection/export must recheck those same grants, not bypass them through an ID.
The Agent uses the current book scope and original spoiler boundary. Export into
an actor-owned sealed ResourceRef composes with existing preview/read/save/release;
saving is a separate explicit native file operation, not a side effect of reading.
An export outside the app cannot be revoked by later deletion or policy changes.
There will be no plugin-specific duplicate model tools for the same recipes.

## Delivery Boundaries

The immutable-artifact contract, native event-sourced version history, conditional
publication and internal user-profile and stored-conversation producers are
implemented. MEM13 remains partial until reading-intention and book-memory source
assemblers, authorized history/read/export,
Agent tools, native user flow and ResourceRef lifecycle are wired with focused tests.
Reading Goals provider intent and book spoiler boundaries must use their real
owners rather than broad raw KV reads. Stored conversation bundles use a narrow
native read through the existing summary owner, not its optimistic KV mirror.

After those implementation conditions close, stage three must verify a formal
plugin's full capture/history/export flow in isolated Tauri, including source
changes, cancellation, revocation, restart/replay, file-save failures, real model
consumption and packaged CSP. Stage-one tests are not that acceptance evidence.
