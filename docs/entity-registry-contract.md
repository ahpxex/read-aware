# Entity Registry Contract

MEM08 needs consumers of the identity projection, not merely event names.
Native entity_query/entity_commit and the shared core query/decision types now
implement the foundation below. The host/Agent/plugin bindings remain to be
connected in stage one; these commands are not new model or Worker authority.
This document is not evidence that those consumers or desktop rounds are done.

## Reads

One memory query supports identities, members and aliases. Identities lists
canonical roots, including pending roots created by earlier merge events.
Members returns original IDs and their own definitions, not copies of the
keeper's definition. Aliases returns owner ID plus observed alias; identical
spellings from different members retain provenance. Member/alias queries accept
any known member ID and resolve its current root. Unknown IDs return an empty
page with null canonicalId, never an invented pending identity.

All modes are ordered and paged: default 25, maximum 100, nonnegative offset;
later pages require the observed entities1 revision. Identity search is literal
substring matching of IDs, canonical names and retained aliases, with SQLite's
ASCII case folding. It never interprets FTS or wildcard syntax. Search is at
most 128 UTF-16 units. Results bound entry count; historical event fields were
not size-limited, so this is not an absolute byte or parsing-memory guarantee.
New public writes bound IDs to 256, kind to 64, names/aliases to 512 UTF-16 units
and each resolve request to 32 aliases. No data is silently truncated.

The revision hashes the ordered entity definitions, retained aliases and flat
redirect projection, including event identities. Hashing streams rows rather
than materializing the registry. This costs O(registry size), with memory
bounded by one stored row, not constant query CPU. A change anywhere in the
registry invalidates pending pages and writes conservatively. Checkpoint
bootstrap does not need its event-log backfill to reproduce the same revision;
stale projections reject reads and writes until replay completes.

## Decisions

Resolve updates the specified original member definition and adds aliases;
it does not silently edit the keeper when supplied a merged member ID. A new
ID can be defined after reading the current registry version. Merge requires
known classes with resolved keeper definitions, so user decisions cannot create
invisible identities by typo. Already-equivalent classes are a no-op. The
keeper's definition wins, and all original member definitions/aliases remain.

Both decisions compare the full observed registry revision in an immediate
SQLite transaction, then append/apply one existing canonical domain event and
its outbox row. Duplicate/stale local envelopes reject before writing. Same
definition plus already-known aliases is a no-op, not a fabricated event. No
blind conflict retries: reread and renew the decision. Local transactions are
not distributed CAS; offline devices merge their event logs in canonical HLC
order under the existing replay rules.

The intended public bindings stay within memory: reads require memory:read
(write implies read), decisions require memory:write. Agent decisions show the
exact proposed identity change and require host approval; book-local digest
characters are not automatically imported or matched by spelling. These are
global, explicitly resolved identities, not a way around book spoiler scopes.
Cancellation before dispatch prevents the candidate event; dispatched native
work drains to its real receipt. Retired consumers cannot receive late pages.

## Closure

Native queries/mutations, bounded core validation, the shared host service,
Agent tools/ports, plugin grants and lifecycle tests must all land before this
chain counts as wired. Entity consolidation remains a separate producer gap,
not something manual resolve/merge claims to implement. Stage two adds actual
composition workflows; stage three proves real Worker/Tauri/merge/bootstrap,
failure/revocation and packaged behavior. Neither is replaced by unit tests.
