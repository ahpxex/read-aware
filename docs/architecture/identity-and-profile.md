# 画像、实体身份与自动整理

本页合并原画像投影、实体注册表和身份巩固三份说明，保留各自的数据与执行契约。
画像是对读者的认识；实体身份用于识别书中的同一个人物或对象；自动整理从已有记忆
中提出和提交有证据的更新。三者共用事件与投影，不另建一份画像数据库。

当前调用链已接。
人工确认的画像与模型派生画像保持区分，后者不能冒充用户亲自确认的事实。

<a id="profile-projections"></a>
## 画像与实体的数据规则

### Deterministic State

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

### Replay And Upgrade

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

### Profile Summary Migration

#### Summary Migration Contract

Native `profile_initialize`, `profile_inspect` and `profile_commit` implement
the transaction side below. They are registered internal IPC commands, not new
plugin/model authority. Startup now invokes initialization, removes the legacy
settings mirror and logs migration failure; profile operations retry
initialization rather than reading a stale KV fallback. ProfilePort, prompt
assembly, onboarding and public pages/edits/observations share this projection
through memory domain 2. The complete encrypted backup restores the summary
with the rest of the event log and projections.

The host initializes the summary with a system-origin event envelope minted by
the existing frontend HLC service. Native code supplies the actual durable KV
value inside the same transaction that deletes the legacy key. A prior summary
event, including an explicit null clear, takes precedence; displayName-only
events do not prevent importing the old summary. Incomplete/stale history cannot
decide this precedence. Initialization retries after failure and never publishes
a second independently writable summary cache.

Profile revisions become `profile2:` hashes of `[summary, lastProfileEventId]`.
Native writes compare the observed revision inside an immediate transaction;
an A-to-B-to-A change invalidates an old decision. Edits are limited to 16000
UTF-16 units, use profile.updated and reject stale event clocks before
committing. The host-only `profile_restore` entry that let v1 backups restore
longer historical summaries was removed when the v1 backup was retired
(2026-09-27).
Memory domain 2 records the persistence contract as event-log, not device-local.

The native reader refuses unretired legacy KV or stale projections instead of
reporting an empty summary. Commit requires a fresh local-device envelope after
the entire log/checkpoint frontier and rejects duplicate IDs. Equal text is a
no-op only after the observed revision and envelope pass validation. Origin is
provenance, not authorization: the host must keep initialization outside
the Agent/plugin bridge and retain existing grants for normal profile edits.

Normal onboarding takes a fresh snapshot and uses the same conditional
summary write; its subsequent memory seeds remain separate transactions.

Public reads remain bounded and writes conditional on the observed revision.
Existing memory 1.x consumers must explicitly move to memory 2; this is a
coordinated breaking contract, not an adapter that silently accepts profile1
decisions.
Entity resolve/merge still need bounded read/conditional write APIs with explicit
memory authorization and ownership/cancellation checks. Full interview/seed
orchestration and consolidation are not implemented by summary migration.

Stage one uses native transactional/replay tests and targeted permission/type
checks only. Formal composition plugins belong to stage two; actual Tauri,
cross-device/bootstrap, concurrent/failed/revoked operations and packaged plugin
rounds belong to stage three. Neither is replaced by projection unit tests.

<a id="entity-registry"></a>
## 实体查询与人工决策

### Reads

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

### Decisions

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

### 验证边界

查询、修改、授权和批准链已经接通。自动整理见下一节；当前组合验收以 C01 为准，
已有单测和受控 Worker 证据不单独证明完整桌面行为。

<a id="identity-consolidation"></a>
## 自动整理与派生画像

### Current Status

Native snapshot/conditional commit, the v34 local checkpoint, typed host service,
bounded automatic inference/idle production and evidence-validated prompt
consumption are implemented. Public inspection now uses `inspect_user_profile`
and memory 2.3 `queries.profileContext` / `events.observe(kind=profileContext)`.
The producer ports remain internal. Schemas 39–40 add durable intermediate pages
and a compact resume frontier for oversized memory evidence. Oversized registries
now use a revision-pinned partition scan and exact selected-member hydration.
MEM08 is wired pending integrated acceptance; no partial pass is labelled complete.
Existing curated profile APIs retain their meaning.

### Ownership

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

### Native Boundary

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

### Producer And Consumers

The automatic producer first tries a complete, revision-pinned JSON envelope of
eligible memories and registry classes/members/aliases. Input is capped at 48000
UTF-8 bytes and constrained further by the model window after output/framing
reserves; output is capped at 4096 tokens.

Oversized memory evidence uses a deterministic binary reduction tree. Leaf JSON
is at most 8000 bytes, fragments retain exact UTF-16 offsets without splitting
surrogate pairs, and each digest is at most 3500 UTF-8 bytes including its cited
memory IDs. Each maintenance pass makes at most four model calls, including the
final publication call. Every source fragment is visited before publication;
digests can omit unsupported claims and are inferred summaries, not raw evidence.
Entity decisions can cite only IDs retained in the final input. Full source
conditions still accompany publication so an omitted source can invalidate it.

Internal work.read/append crosses the typed host service to SQLite. Schema 39's
device-local work header and immutable pages bind the complete input revision
and a versioned SHA-256 key for each node. Identical append retries return the
retained receipt; conflicting content or changed sources reject. Pages and count
commit together, survive restart, and never emit profile events or completion.
Final successful completion clears scratch in the publication transaction.
Shutdown settlement and automatic-building revocation drain dispatched appends;
revocation prevents further calls and writes. These ports are not plugin APIs;
plugins and Agent inspection consume the existing profileContext projection.

Schema 40 retains at most 4096 uncompressed pages of 48000 bytes each, plus one
256000-byte checkpoint. The producer compacts each consumed node: it stores the
exact next source/UTF-16 cursor, binary carry levels, current reduction and final
fold position. Pure cursor/state validation is separate from async orchestration.
At most 53 levels are needed within JavaScript's safe integer index range.
Normal operation retains only an in-flight page; old schema39 pages are reused in
order and compacted after their suffix is consumed. Restart resumes directly at
the cursor without scanning or re-inferring previously compacted source text.

Compaction atomically checks the complete source revision and exact monotonic
page tail, persists the frontier and removes the consumed pages. Indices never
reset within that source revision: a stale append or compactor cannot replace a
newer checkpoint, including after reopen. Identical compaction retries are
idempotent. A failed compact leaves its inference page reusable, so retrying does
not repeat the model call. Index zero reads the header/frontier even after page
zero has been pruned; other pruned reads conflict. Compaction emits no domain
events, obeys the same cancellation/drain policy and clears on final publication
or data wipe. A model too small for a leaf/registry partition remains pending with
a logged capacity reason. The native snapshot still loads the full eligible source
set, so bounded model payloads do not imply bounded total process memory.

When the complete registry cannot fit, the producer first reduces the full memory
source set, then scans every canonical class, original member and accumulated
alias under the captured registry revision. The same public entity query supplies
pages of at most 100 rows; model partitions split further by encoded byte size
without dropping rows. Class definitions stay attached to each partition. The
selector retains a bounded shortlist of original/canonical ID pairs and inferred
identity context, never model-written definitions or mutations. Its output is at
most 3500 bytes, and final hydration reserves worst-case escaped definition space
for 1–8 references according to model capacity. All phases share the four-call
maintenance allowance and compact each completed node.

Journal frontier version 3 wraps the existing memory state and a registry cursor
(class offset, member/alias phase, row offset) plus shortlist. Version 1 node pages
and version 2 memory frontiers remain resumable. A failed model call, page read or
checkpoint cannot skip a partition or publish a truncated scan. Changed sources
or registry invalidate both phases. After the scan, exact selected original and
canonical definitions are re-read under the same registry revision. Final input
explicitly declares that member/alias lists are selective; the inferred registry
summary is not raw evidence, and an absent shortlist entry is not proof that an
identity does not exist. Code-generated new IDs are checked against the complete
registry before commit, so they cannot overwrite omitted existing identities.

If needed references exceed the shortlist, the selector must set hasMore. This
flag persists through the scan and forces partial publication even if the final
model claims complete. The next maintenance pass reevaluates remaining work
against the committed definitions. Which identity matches are supported, whether
remaining work is recognized, and whether partial passes converge require model
semantic acceptance; structural validation alone does not establish those facts.

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
Both oversized evidence and valid oversized registries have resumable production paths.
Incomplete model work stays pending with logged diagnostics, not a successful pass.
Curated profile edits win by separation and read-set conflict checks. Forgotten
or superseded evidence invalidates the derived layer before regeneration.

### Public Inspection

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
Integrated Worker/Tauri/SQLite acceptance remains governed by C01 in the current
acceptance list. The supporting checks above do not independently close that boundary.
