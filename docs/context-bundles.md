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

## Actor And Export Boundary

The public operation will select a recipe/scope, not SQL, KV keys, paths or raw
events. Each recipe must require the domains it actually reads; historical bundle
inspection/export must recheck those same grants, not bypass them through an ID.
The Agent uses the current book scope and original spoiler boundary. Export into
an actor-owned sealed ResourceRef composes with existing preview/read/save/release;
saving is a separate explicit native file operation, not a side effect of reading.
An export outside the app cannot be revoked by later deletion or policy changes.
There will be no plugin-specific duplicate model tools for the same recipes.

## Delivery Boundaries

The first unit implements the shared immutable-artifact contract and native
event-sourced version history only. MEM13 remains partial until the actual source
assemblers, conditional publication, authorized history/read/export, Agent tools,
native user flow and ResourceRef lifecycle are wired and have focused tests.
Reading Goals provider intent, rolling conversation insights and book spoiler
boundaries must use their real owners rather than broad raw KV reads.

After those implementation conditions close, stage three must verify a formal
plugin's full capture/history/export flow in isolated Tauri, including source
changes, cancellation, revocation, restart/replay, file-save failures, real model
consumption and packaged CSP. Stage-one tests are not that acceptance evidence.
