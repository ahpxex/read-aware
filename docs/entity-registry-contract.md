# Entity Registry Contract

MEM08 needs consumers of the identity projection, not merely event names.
Native entity_query/entity_commit, core query/decision types and the shared host
service now implement the foundation below. Memory 2.2 exposes plugin entity
queries and conditional decisions through the existing memory grants. Agent
query/decision tools now use that host service and explicit chat approval.
Consolidation remains to be connected in stage one. This document is not
evidence that desktop rounds are done.

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

Agent approval binding: member/alias pages also return canonicalDefinition from
the same native read transaction, null for unknown/pending roots and identity
lists. This avoids scanning all member pages merely to name the keeper in an
approval prompt. Memory 2.2 advertises this additional result contract. The
Agent's two tools query_entities/manage_entity share one explicit entity port;
manage_entity freezes the full candidate, pins both merge-class inspections to
its revision, then shows candidate plus current canonical names/IDs and member
counts in host confirmation. Merge rejects unknown/pending classes before
asking. Resolve may define a new original member; resolving an already-merged
member never claims to rename its keeper. Native CAS arbitrates changes after
approval, with no retry or implicit approval. This binding is independent of
automatic memory-building policy and does not import book digest characters.

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

The plugin bindings stay within memory: queries.entities requires memory:read
(write implies read), commands.decideEntity requires memory:write and an active
activation. Both accept per-call cancellation; the Worker strips local signals
and injects a host-owned signal. Entity reads use the existing shared 32-read
capacity and retain source ownership until IPC settles, even after cancellation.
Agent decisions show the exact proposed identity change and require host
approval; book-local digest
characters are not automatically imported or matched by spelling. These are
global, explicitly resolved identities, not a way around book spoiler scopes.
Cancellation before dispatch prevents the candidate event; dispatched native
work drains to its real receipt. The entity-write Worker proxy sends cancellation
but waits for host arbitration, retaining its pending-call slot. Native failure
codes are not overwritten by a concurrent cancellation. The existing RPC deadline
and Worker loss still bound waiting: either leaves an unknown write outcome, not
proof of rollback, and must not trigger a blind retry. Retirement waits for the
native source transaction but cannot promise delivery into a terminated Worker.
Retired consumers cannot receive late pages. Changed transactions alone broadcast;
conflicts and no-ops do not emit fake success events.

## Closure

Native queries/mutations, core validation, the shared host service, plugin grants,
Agent tools/ports and host approval are wired, with targeted lifecycle/Worker
transport and in-process AgentThread/chat tests. They do not prove desktop E2E.
Profile/entity consolidation remains a separate producer gap,
not something manual resolve/merge claims to implement. Stage two adds actual
composition workflows; stage three proves real Worker/Tauri/merge/bootstrap,
failure/revocation and packaged behavior. Neither is replaced by unit tests.
