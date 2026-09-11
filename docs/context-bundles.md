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
The reading-intention producer is wired through opted-in active providers below;
the book-memory producer below is also wired. Public actor operations and file
export remain required.

## Actor And Export Boundary

### Sealed Resource Disclosure

The export transport must not turn archive integrity into authorization. Its
host-only entry point validates and copies the exact artifact, then writes and
seals deterministic UTF-8 JSON in the existing actor ResourceOwner. Only the
ready, actor-local reference is returned; no native ID or writable intermediate
handle crosses the actor boundary. Serialization preserves the complete version
and content, without rehashing a redacted variant under the old version.

Every context resource owns a mandatory host disclosure lease: a synchronous
current-policy predicate, a revocation signal, and observer cleanup. Acquisition,
metadata access and each byte read check that lease; asynchronous reads recheck
before delivering bytes. Revocation schedules serialized native cleanup and
prevents further access even if cleanup fails. Release remains possible without
permission. Context resources cannot be used as generic book-import inputs or
image-decoding/clipboard inputs, and cannot be appended to after sealing.

Saving rechecks authority, expiry and owner lifetime after the native dialog,
immediately before dispatching the filesystem write. Cancellation or revocation
before dispatch prevents the copy. After dispatch, the real write receipt is
drained and returned: a completed external write must not be reported as cancelled.
Already delivered bytes or completed external files cannot be recalled.

This transport does not provide a permissive default lease, public actor grant,
or retrospective spoiler proof. Actor recipe grants, policy observers and the
native/Agent disclosure flows must supply those separately before public wiring.

### Durable Resource Admission

JavaScript observers alone cannot detect a source write from another SQLite
connection before resource delivery. A context resource therefore also binds the
device-local source revision captured around its authorized source proof. Native
context sealing validates the complete artifact and checks that revision in a
SQLite transaction. Subsequent native reads and saves repeat the check against
the attached revision; callers cannot refresh it by resealing a ready resource.
Generic native consumers reject context files rather than cloning an unguarded
descriptor. Release is unconditional. Ordinary resources retain their existing
behavior and do not acquire a database dependency.

This is admission against a committed source snapshot, not a native actor grant:
the host still supplies recipe/scope/privacy/reading authority. A source commit
after a read/save has been admitted does not recall dispatched work; a later
operation must fail. Rollback preserves validity, while ABA, wipe, stale
projections and missing/corrupt clock state deny use. Any tracked source change
may conservatively invalidate a resource, including an unrelated change; it must
be reacquired through current authorization, never rebound in place.

### Pinned History Reads

The implemented internal history queries select exactly one recipe and scope, never a version ID alone or
an unfiltered all-user index. Pages contain version IDs and publication times,
not source text. They are newest-first, ordered by publication time and version.
A `cbhist1` revision binds the complete ordered metadata set and selector;
continuation requires that revision and rejects changes rather than mixing pages.
The history index is streamed for the revision; a page does not load every stored
artifact body. A pinned read must repeat the selector and validate the stored
artifact hash, scope/recipe columns and ordered source-index rows before delivery.
Absent is null; stale projections, broken storage and invalid artifacts are errors.
These reads do not migrate source owners or require the original book to still
exist: this is a durable archive, not a current-source query. Metadata discovery
does not load or certify every artifact body; pinned reads perform that integrity
check. Public authorization must separately determine whether a retained version
may still be disclosed. The existing v35 index serves these queries; no additional
projection writer, history cache or schema migration is introduced.

These native reads and their host adapter remain internal until the actor gates
are wired. A history revision is a consistency token, not a grant. In particular,
an old bundle can contain text that current privacy, source-provider or reading
boundaries no longer allow. Artifact immutability does not authorize disclosure:
public consumers must check current grants before and after asynchronous reads,
and must not rewrite/redact an old artifact while retaining its original version.
Where historical provenance cannot establish the current fence, text delivery
must be withheld rather than inferred from a version ID. File export also needs
an actor-owned resource whose later use rechecks the applicable policy.

### Book Memory Sources

The implemented book recipe reads one durable, book-scoped SQLite snapshot: active book
memories, annotations and chapter digests, together with classification, saved
position and source/derived-text blob hashes. It never queries user/global memory
or conversation messages. The host verifies derived-text bytes against the
captured registry hash and uses the existing v5 parser only for chapter hrefs;
it does not extract text or start inference. A new local source-clock migration
tracks blob-registry writes too, including replacement and deletion. A failed
blob replacement that leaves bytes inconsistent with the registry must reject.

Narrative books expose only completed chapters before the current chapter;
finished or expository books have no chapter fence. The active reader overrides
the persisted position, including loading/unknown state. A session/position/source
change invalidates capture through dispatch, including move-away-and-back.
Memories have no chapter provenance, so they are omitted while a narrative fence
is in force. Unlocated annotations are likewise omitted; flavor-mismatched
digests are unavailable. This is a provenance fence, not a semantic proof that a
note or model summary cannot mention later events. All omissions are counted.
Historical digests have href/index provenance but no edition hash; the artifact
must not misrepresent them as content-version-verified source passages.

The recipe retains complete selected text and structured digest entities and
relations. Stable IDs and content hashes, not timestamps or mutable row order,
identify its sources. Oversized source sets/artifacts fail explicitly, never
silently truncate. The native source snapshot is bounded to 8192 rows and 8 MiB
of source text before materialization; the final artifact retains its 512-item,
1-MiB limit. `bitem1` hashes identify selected items and `bctx1` identifies the
scope, classification, edition hash, fence, chapter mapping, selected revisions
and counted omissions. Native actor authorization and export remain separate gates.

### Reading Intention Sources

Reading intentions come from active, explicitly opted-in context providers, not
an unrestricted scan of private plugin storage or a guessed search for preference
memories. `agentContextProviders` 1.1 adds a reading-intent source with declared
user/book scopes, a preparation step for migration/durability, and a read-only
snapshot step returning stored text plus its source revision (including cleared
tombstones). Preparation precedes the native source clock; snapshots follow it.
Providers must use durable storage covered by that clock, not generated or
optimistic callback state. Their text is attributed source data, never authority.

The host freezes the participating provider registrations, cancels a capture if
that set changes (including replacement or off/on), and checks each provider's
host-owned lifetime. Book existence is checked before preparation and again
inside the captured read set. Provider failures reject the entire recipe, not
a silently shortened bundle. There is no provider count truncation. The content
identity uses stable provider IDs, scope, source versions and text, independent
of registry order or translated plugin names. No provider in a scope means no
available declared intention, not proof that all disabled private stores are empty.

Reading Goals opts in for book scope. It promotes its own legacy goal before
capture, then reads its durable document without triggering another migration;
cleared documents supersede legacy values. It does not invent a user-wide goal
or export its suggest-memory setting as an intention. Capture before native
dispatch respects source retirement; a publication already dispatched drains to
its actual receipt and is not falsely reported as rolled back on retirement.

The legacy promotion must also read durable bytes. Storage 2.4 therefore adds
`getDurable(key)` alongside the existing optimistic synchronous `get`: it settles
accepted namespace writes and reads that one namespaced SQLite key, rejecting
corrupt JSON and late retired results. The Worker uses RPC rather than its mirror.
Reading Goals uses this path both for promotion and for detecting an unprepared
legacy source; a cache miss must not turn a real stored goal into an empty bundle.

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
publication and all four internal recipe producers are implemented. MEM13
also has scoped native history pagination and integrity-checked pinned reads with
a cancelling host adapter. MEM13 remains partial until authorized history/read/export,
Agent tools, native user flow and ResourceRef lifecycle are wired with focused tests.
Reading Goals provider intent uses its own durable documents and private legacy
promotion; book spoiler boundaries must also use their real owner. Stored conversation bundles use a narrow
native read through the existing summary owner, not its optimistic KV mirror.

After those implementation conditions close, stage three must verify a formal
plugin's full capture/history/export flow in isolated Tauri, including source
changes, cancellation, revocation, restart/replay, file-save failures, real model
consumption and packaged CSP. Stage-one tests are not that acceptance evidence.
