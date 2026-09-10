# ReadAware Plugins - Agent Reference

> Audience: coding agents and maintainers.
>
> Status: architecture reference from 2026-08-23, qualified by the source
> audits linked below. API presence does not establish complete semantics,
> durability, lifecycle safety, or desktop acceptance.
>
> Compatibility policy: the current ecosystem is first-party. Do not add old
> API aliases, adapters, fallbacks, or compatibility shims.
>
> Concise human-facing version: [plugin-system.html](./plugin-system.html).

> Audit guidance updated 2026-09-10: use the [unified capability model](./host-capability-model.md)
> for target ownership, both actors, and explicit limits on infrastructure;
> use the [current matrix](./host-capability-matrix.md) for actual wiring and
> the [acceptance baseline](./plugin-capability-baseline.md) for GAP01–GAP18.
> Those gaps remain open. This reference preserves the original three-family
> model; broad claims below about transactional updates and retired results
> must not be treated as evidence that every failure path is safe.

## 1. The Model

ReadAware has one plugin capability model with three semantic families:

1. **Domains** expose state and behavior ReadAware already owns.
2. **Contributions** let a plugin supply a new implementation, action, choice,
   or provider to a host-owned extension point.
3. **Services** let a plugin ask the host to perform a bounded platform,
   infrastructure, or lifecycle operation.

Declarative UI grammars are versioned contracts alongside those families, but
they are not a fourth source of application authority.

Every capability identity, permission, and version is declared in a canonical
catalog. The runtime derives manifest permission validation, actor visibility,
compatibility checks, and discovery from those catalogs. The worker bridge
derives its callable shape from the actor-scoped context rather than maintaining
another method list.

Dynamic loading means the host does not name installed plugin IDs. It does not
mean a plugin can invent arbitrary host behavior, UI mount points, or native
operations.

## 2. Boundary Test

Use this test before adding any plugin API:

| Question | Owner |
| --- | --- |
| Is this state or behavior ReadAware already owns? | Domain |
| Is the plugin supplying a new implementation or choice? | Contribution |
| Must the host perform a bounded external operation? | Service |

Examples:

| Need | Correct shape |
| --- | --- |
| Read the active book | Reading domain |
| Change the selected app theme | Settings domain |
| Supply a new app or reader theme | Theme contribution |
| Read the selected voice | Settings domain |
| Supply a speech engine and voices | Voice-provider contribution |
| Navigate to another chapter | Reading domain |
| Add an action for selected text | Selection-action contribution |
| Call a remote API | Network service |
| Store a credential | Secrets service |

Do not merge the families into a generic string-addressed invoke API. Their
ownership, lifecycle, validation, and permission semantics are different. The
shared part is the registry architecture.

## 3. Canonical Sources

The architecture is split by responsibility:

| Responsibility | Canonical location |
| --- | --- |
| Domain IDs, access levels, versions | `packages/core/src/domains.ts` |
| Contribution/service/schema IDs, permissions, versions | `packages/core/src/capabilities.ts` |
| Public plugin contract | `packages/plugin-types/src/index.ts` |
| Runtime domain definitions | `apps/web/src/domain/registry.ts` |
| Settings catalog and behavior | `apps/web/src/domain/settings/` |
| Manifest validation | `apps/web/src/features/plugins/lib/manifest.ts` |
| Actor capability resolution | `apps/web/src/features/plugins/runtime/plugin-capabilities.ts` |
| Plugin context construction | `apps/web/src/features/plugins/runtime/plugin-context.ts` |
| Activation barrier and staged registrations | `runtime/plugin-lifecycle.ts` |
| Worker boundary and derived RPC shape | `plugin-worker-host.ts`, `plugin-sandbox.worker.ts` |
| Contribution ownership and inspection | `state/contribution-registry.ts`, `state/plugin-store.ts` |
| Install/update transaction | `runtime/plugin-update-transaction.ts`, desktop `plugins.rs` |
| Data migration planning | `runtime/plugin-data-migration.ts` |
| Agent extension consumers | `runtime/plugin-tools.ts`, `packages/agent/src/runtime/extension-context.ts` |

Do not add a capability ID or permission in a feature-local switch. Extend the
owning catalog and let its consumers derive the new vocabulary.

Domain operation contracts remain owned by their domain modules and the public
type package. A new operation normally changes the owning domain contract,
implementation, plugin adapter, and contract tests. It must not require a new
permission list, worker method list, or installed-plugin switch.

## 4. Actor-Scoped Runtime

The same product capabilities are resolved for distinct actors:

- `user` for product UI;
- `agent` for the core ReadAware agent;
- `plugin:<id>` for one installed plugin;
- `system` for trusted host pipelines.

A plugin receives only its actor view. The view contains:

- its validated manifest;
- app version and locale;
- visible capability versions;
- the host-owned lifecycle phase;
- allowed domains;
- allowed contribution registries;
- allowed host services.

Unavailable capabilities are absent. Invocation still crosses the worker
boundary and resolves against the host-side actor context, so hiding a method is
not the only authorization check.

The plugin runs in a module Worker. It has no React, Jotai, DOM, WebView,
Tauri, SQLite, filesystem, or process handle. All host interaction crosses the
typed context. Ambient Worker network and persistence APIs (`fetch`, WebSocket,
IndexedDB, Cache Storage, BroadcastChannel, and related escape routes) are
disabled; network and durable state must use granted host services.

RPC calls now have a 120-second deadline and a 256-pending-call limit per
direction. Clone failures settle their pending call, and runtime errors reject
waiting contribution invocations. Network v1.1 preserves Request inheritance,
headers and binary bodies, forwards cancellation to native HTTP, and buffers at
most 64 MiB per body in each direction. Stopping a realm cancels its native HTTP
requests. Cancellation does not undo server-side effects or already committed
domain writes. General callback ownership, cancellation of other host tasks,
wire-envelope validation and packaged CSP remain separate acceptance work; see
[implementation and desktop evidence](./host-capability-delivery.md).

## 5. Domains

A domain owns read models, queries, commands, events, validation, business
invariants, and persistence semantics. Queries inspect state, commands request
state changes, and events report committed changes.

The current public roster is:

| Domain | Owns | Plugin exposure |
| --- | --- | --- |
| Library | books, source files, metadata, TOC, collections, import and removal | `library:read`, `library:write` |
| Reading | active session, navigation, location, progress, reading time | `reading:read`, `reading:write` |
| Annotations 2.0 | highlights, notes, passive question traces, conditional edits and query observations | `annotations:read`, `annotations:write` |
| Conversations 1.2 | threads, summaries, live state, thread management and host-confirmed turn requests | `conversations:read`, `conversations:write` |
| Settings | catalog, resolved values, targets, validation, change events | exact path grants |
| Memory | active memory search, chapter graphs and conditional feedback | `memory:read`, `memory:write` (1.1) |

Profile projection and raw memory projection writes remain internal. A page, React
feature, menu, or route is not a domain merely because it has a name.

There is no `shelf` domain. Library ownership and active reading behavior are
separate. Do not restore `shelf` as an alias.

Conversations 1.1 adds `queries.runtime()` and `events.observeRuntime(handler)`
(initial snapshot plus changes), with mounted session identities, loading,
streaming and message counts. `conversations:write` exposes `createThread`,
`selectThread`, `stop`, and `clear`; plugin retirement aborts pending controls.
Create persists the selected empty global draft; the first message creates its
transcript row. Select requires an existing thread or the selected draft and
does not navigate the app. Stop/clear block new turns and wait for in-flight
turns' final persistence before completing. Clear also discards hidden Agent
thread state and insights, not long-term memory, event history or completed
tool effects; its multiple writes do not promise atomic rollback. Agent state
queries are book-scoped or global; management is global-only, requires approval
for clear, and refuses stop/clear of the executing thread.

Conversations 1.2 adds `commands.requestTurn({target, action, text?})`, where
`action` is `draft`, `send`, or `retry`. Draft/send accept 1–65536 characters;
retry rejects replacement text and preserves the original user message and
attachments. A mounted chat surface must exist; submitting does not navigate.
Each target permits one pending proposal, expiring in five minutes. Only host
chat controls can accept or dismiss it. Draft adoption refuses to overwrite
typed text; send/retry require an idle unchanged transcript generation. A host
stop/clear, surface close/replacement, or actor cancellation retires pending
requests. `cancelTurnRequest(id)` can cancel only the caller's request, not undo
an accepted draft, started turn or its effects. `queries.turnRequests()` returns
actor-owned metadata without text; the host retains at most 128 recent entries.
State changes invalidate `observeRuntime` so consumers can re-read outcomes.
Statuses are `pending`, `adopted`, `started`, `dismissed`, `cancelled`, `stale`,
`failed`, or `expired`; none promises a completed model response or durable job.
Agent `request_conversation_turn` uses the same path, restricted to the current
book in book scope; state queries show the last 20 scoped requests and a
truncation flag. Streaming output remains in native chat, not a public role-write
API. Focused checks passed; integrated plugin/Tauri acceptance is pending.

Reading v2 exposes `queries.session()` and `events.observeSession(handler)`:
an immediate snapshot followed by revisions, with session identity, loading
status, versioned actual location, bounded visible text, and history availability.
`openBook`, `goTo`, `back`, `forward`, and `step` return completion receipts;
`close` waits for the session to close. Back/forward/step/close accept an optional
book/session guard. Source hashes reject stale locations; virtual sources without
a durable revision use session-scoped versions. The Agent uses the same controller.
Reading 2.5 additionally exposes mode/provider discovery and configuration,
versioned mode positions, unit stepping/return, and playback start/stop with
shared session snapshots. Listening Desk consumes these commands; Agent tools
use the same owners. Library precise search returns versioned navigable
locations, used by Jumper and Agent navigation. Generic selection/Range editing
and temporary overlays remain incomplete, rather than all mode/playback/search
capabilities being absent.
Engine work cannot yet be aborted per navigation; cancelling a waiter is not a
promise that a physical move was undone. PDF completion waits for rasterization,
which an occluded WKWebView may suspend until it is visible.

### Annotation Conditional Contract

[代码] Annotations **2.0.0** removes the five unconditional public commands
`recolorHighlight`, `removeHighlight`, `updateNote`, `removeNote`, and `removeAsk`.
The complete plugin command set is now `createHighlight`, `createNote`, and
`applyChanges`. Creation is unchanged. Every edit/delete uses `applyChanges`
with the revision obtained from the observation that informed the decision,
not a fresh read immediately before saving an older draft. One request contains
1–100 distinct existing annotations; all conditions pass and all events commit,
or nothing changes. Supported mutations remain note body, highlight color/style,
and deletion of note/highlight/ask. Missing or wrong-kind objects return
`annotations/not-found`; changed revisions return `annotations/conflict`.

[代码] This is a deliberate breaking contract, not a compatibility alias that
silently obtains a current token. Catalog, SDK, permission-gated host context and
derived Worker shape agree. `^1.x` requirements fail activation negotiation;
`^2.0.0` callers need read/write grants as before. Read-only actors receive no
commands; no plugin can create an ask trace. Agent ports also remove their three
unconditional aliases (`recolorHighlight`, `updateNote`, `removeAnnotation`);
model tools use the existing shared conditional command and bind destructive
approval to the observed object version. Plugin write authorization is still
not the same as per-operation Agent approval.

[代码] Annotation Desk **0.3.0** declares `annotations: ^2.0.0`. Its existing
frozen detail/batch snapshots remain unchanged; this migration does not replace
stale drafts or add hidden retries. All source native/Worker test consumers are
migrated. Eight localized public sample manifests now request annotations 2 and
awaited storage 2. The host-only backup restore `saveAnnotation/annotation_put`,
one-time import, replay and remote-event ingestion remain trusted restoration
paths, not exported edit commands. This change is local optimistic concurrency,
not distributed CAS or a prohibition on host restoration.

[环境] [Annotations 2 evidence](./evidence/annotation-contract-v2-2026-09-10.json)
records actual macOS debug Worker command keys, read-only exclusion, old-version
negotiation rejection, conditional ask deletion, wrong-kind/missing failures,
atomic stale/fresh batches and Agent approval conflicts. The compiled Desk's
real text input remains intact after another Worker changes the note and Save
returns conflict. Agent tools and approval replies were driven programmatically,
not by autonomous inference. The native global annotation popover now shares
`useAnnotations` with book-scoped lists: initial/changed/error/recovery snapshots,
displayed revision deletion, scope teardown and no late imperative filtering.
A remote projection update immediately before native Delete rejects the stale
decision with localized copy; a subsequent observed delete succeeds. A targeted
SQLite type fault clears contents, actions and count; restoring the exact field
recovers without reopening. No maximum-library-size, packaged, cross-device or
Windows/Linux coverage is claimed. Unified Range, bounded native collection
payloads and full remote event delivery remain separate gaps.

### Annotation Query Observations

[代码] Annotations 2 retains `events.observe(query, handler)` introduced in 1.4 alongside the legacy
`events.subscribe(event, handler)`. Read access exposes both; write implies read.
No grant means no annotations domain. The new query is exactly one of:

- `{ kind: "page", query?: AnnotationPageQuery }`: reuses page filters and live
  keyset cursor, default 20 and maximum 100 rows. Cursor/filter validation stays
  authoritative; query normalization rejects unknown fields.
- `{ kind: "inspect", annotationId }`: exact item plus atomic conditional-write
  revision, or `null` for absence. IDs must be nonblank strings of at most 512 characters.

[代码] Observation is `{ revision, status: "ready", result }` or
`{ revision, status: "error", errorCode }`. Results discriminate `page` with a
`page` field and `inspect` with a `snapshot` field. Revision orders deliveries
within this subscription only, not database state or a write precondition.
Queries/results are copied before callbacks; caller mutation does not retarget
the subscription. Storage errors are logged and surfaced as stable codes, not
empty pages. Unknown read failures use `annotations/observation-failed`.

[代码] The host reads immediately, then schedules another read one second after
both read and callback settle. Only changed results/errors and recovery are
delivered. A rejected callback is not acknowledged, so the unchanged value is
retried. Reads and deliveries never overlap for one observer. At most 64
public subscriptions exist across all owners; overflow is `annotations/observer-limit`.
Invalid input/callback is `annotations/invalid-input`; retired owners reject with
`annotations/cancelled`. Disposal is idempotent, cancels the timer, releases the
quota slot and drops late completions. Worker retirement owns the disposable.
Polling reads actual committed projections, including sync/rebuild changes that
did not emit local domain events. It does not replay every intermediate state,
promise immediate revocation, interrupt a hung native read/callback, or provide a
frozen snapshot across different queries. Legacy event subscribe is unchanged.

[代码] Annotation Desk 0.3 combines annotations 2.0, UI 1.2 and views 1.1 for live
browsing at 20 rows/page. Page/cursor history is captured per view; new filters
reset it. Read failure replaces stale contents and actions with a localized
error; recovery repopulates the list. A failed joined book-title lookup also
leaves the callback unacknowledged so an unchanged annotation page can recover.
Book metadata changes alone do not invalidate an unchanged annotation page.
Editing and batch selection remain separate revision-frozen views; background
updates must not replace a draft or silently rebase its write conditions.
The Agent continues calling the same page/inspect read model on demand, not
subscribing a model loop. This is on-demand access, not an automatic model subscription.

[代码] Native Notes, book details, the global annotation popover and Foliate
stored markers now reuse the same serialized observation implementation.
The global popover uses an all-books scope; native whole-book collections have a
separate quota from public subscriptions; they are not new unbounded Worker API
results. `annotations_list` accepts optional `bookId` and filters in SQLite
before decoding/IPC, so an unrelated book's invalid row cannot poison a scoped
read. Native whole-book payloads are still proportional to that book's marks.
The former manual Jotai revision counter and its write-site bumps are removed.
Native mutation callbacks also no longer filter the displayed list or mutate
the marker refs directly: observations alone own the presented collection.
Otherwise a late write acknowledgement could replace a newer delivered state
while observer deduplication suppressed the corrective identical snapshot.
Closing a book clears the hook's retained snapshot, including reopening the
same book; mutation completion still means persistence, not immediate painting.
Book switches/disposal drop old reads; the hook also hides a previous book's
snapshot before the new effect starts. A failed read clears native contents and
stored markers, shows localized stable-code copy and no false zero count;
recovery restores them. Unknown/terminal error codes do not gain a false retry
promise. The book-details dialog also renders unknown counts while loading or
failed, rather than inventing zero highlights/notes.

[代码] Stored-marker reconciliation removes obsolete CFIs, redraws colors/styles
and restores the note marker when the highlight sharing its range is removed.
The first/newest highlight owns a shared range, matching the annotation menu;
notes do not overwrite it. Operations are awaited in order, retirement prevents
subsequent operations, and a failed anchor is logged without preventing other
marks from rendering. Navigator overlays retain their own namespace. Changing
the selected highlight closes its stale menu, but observation does not replace
an open note editor's draft. Native note/menu/list mutations now use the displayed
snapshot's conditional token, as specified below. Public unconditional commands
are removed in annotations 2; see the migration contract above.

### Native Annotation Writes

[代码] Native `annotations_list` captures displayed rows and their `ann1` tokens
in one SQLite read transaction. Its flat DTO adds a read-only `revision` field;
the token uses the same `snapshot_for_annotation` as public inspect, including
the latest locally appended annotation event identity to detect same-millisecond
ABA. The persisted Annotation row and event schema do not gain that field.
Create/get/search/legacy objects without a token are not editable snapshots;
native mutation helpers reject them instead of fetching a fresh pre-save token.
Whole-book reads remain proportional to annotation count, now including event
identity lookup per row; this is not a new bounded Worker list contract.

[代码] Native note editing, highlight recolor/delete, and Notes/book-details
list deletion use the common conditional transaction with origin `user`.
Recolor changes only the requested color, not a style copied from an old menu.
New note/highlight creation retains the existing creation path. `useReaderNoteEditor`
owns a cloned target/note/token and a draft generation. Observations never rebase
that draft; conflict and storage failures retain it. Repeated synchronous save
calls are suppressed while saving, the textarea and submit button are disabled,
and an old save's completion cannot close or clear a new draft. Changing books,
closing or unmounting retires the UI generation, but does not roll back a write
already dispatched. Explicitly opening another draft remounts the editor content,
even if its initial body happens to equal the preceding note's body.

[环境] [Native CAS evidence](./evidence/native-annotation-cas-2026-09-10.json)
verifies real desktop textarea input and Update/Cancel controls: a Worker note
edit and a separate actual Agent `edit_annotation` both make the open old native
draft conflict, preserve its text and leave the competing value intact. Closing
and reopening reads the newer value and permits a normal conditional save.
The native helper also rejects stale highlight recolor/delete after Worker
recolor; a fresh observed token allows deletion. That helper test is not a
pointer-driven menu or independent book-details E2E test. Rust verifies native
list/inspect token identity and equal-millisecond ABA; React tests cover duplicate
save, old callback/completion, replacement drafts and book change.

[环境] The initial two SQLite lock attempts did not capture a successfully
delayed save completion or painted busy state; that historical evidence remains
unchanged. The [storage execution follow-up](./evidence/storage-execution-2026-09-10.json)
now verifies native busy controls, Cancel/reopen while a write is pending, and a
successful old completion after lock release that leaves the replacement draft
open and unchanged. Saving that old replacement snapshot then conflicts.
Another held-lock test kept a 50 ms heartbeat responsive (118 ticks in 6292 ms),
displayed localized database-busy copy, retained the draft, and saved after release.
A dev reload during the initial CAS run also lost the first
fixture's in-memory handles and logged a window-listener teardown rejection;
its known owned rows were removed through domain commands before a fresh run.
No autonomous inference, relay/cross-device, packaged, maximum-book-load or
Windows/Linux claim is made. Native menu/selection completion ownership beyond
the note editor and unified Range remain separate unfinished work. The subsequent
annotations 2 migration removes the legacy public unconditional commands.

### Storage Execution Boundary

[代码] The 100 previously synchronous storage commands and two cover commands
now accept an owned AppHandle and run state lookup, mutex acquisition, SQLite
and filesystem work in the shared `storage/execution.rs` blocking executor.
This includes readers, mutations, reading accrual/position/flush, private plugin
documents, preferences, memory, sync bookkeeping and staged blob sessions.
Existing asynchronous import, secret and replay commands retain their explicit
blocking pools. The literal schema-version getter remains synchronous; it does
not read storage. There are no new public commands, actor grants or SQL access.

[代码] Command payload names, result/error shapes and transaction bodies remain
unchanged. The executor logs a task-join failure and returns stable `internal`
without the panic payload; ordinary CommandError codes pass through. Cancellation
of a waiter does not cancel or roll back work already accepted by the pool.
Raw request bytes are copied before crossing the owned task boundary; this is
not an unbounded-input or memory-quota solution. The rablob URI handler also
responds asynchronously so cover requests cannot wait on this mutex in UI
dispatch. Boot initialization and native window-exit flush remain synchronous;
this does not claim all native work or OS shutdown is nonblocking.

[环境] Rust AST regression scans storage commands plus cover/import/secret
consumers for async dispatch, explicit blocking execution and misplaced locks.
An independent token comparison verified 98 mechanically migrated command
bodies and return types unchanged; two raw-body and two cover handlers were
reviewed separately. Actual Tauri tests cover native editing, real Worker
annotation writes, actual Agent edit/query/close tools, successful reader
retirement and cleanup. A generated 2x3 PNG passed raw cover storage and the
rablob protocol, decoding the expected RGBA pixel. The first long-lock attempt
used an awaited animation-frame loop and exceeded bridge wait; it is not the
successful timeout evidence. No maximum pool load, packaged, Windows/Linux,
real multi-device sync or autonomous model claim is made.

[环境] The [native evidence](./evidence/annotation-observation-2026-09-10.json)
covers real SQLite, four WebKit Workers, actual Agent queries and compiled
Annotation Desk: local/remote-store/Worker changes, SQLite read failure and
recovery, preserved conflicting drafts, deletion versus failure, and retirement.
The book is metadata-only, not an import/render test; sync applyRemote is real
but does not exercise a relay or another device. Long-duration/maximum-payload,
packaged and Windows/Linux tests remain; ANN09 and the broader GAPs stay partial.

[环境] Separate [native reader evidence](./evidence/native-annotation-observation-2026-09-10.json)
uses uniquely imported FB2 files, a real Worker and actual Agent queries:
creation/recolor/removal appear in both Notes and Foliate, removal restores the
underlying note marker, remote-store note edits update the list, scoped SQL read
faults clear contents/markers and recover, and switching books isolates updates.
The first run exposed generic error copy and false zero counts; a second run
verified their correction. Book details shares the hook but was not independently
exercised. No autonomous inference, network sync, maximum-book load or packaged
cross-platform verification is claimed.

[环境] The first four native runs exposed a close/retirement race: even an
explicit fixture flush could be followed by a late tracker accrual. The fourth
run left one owned pending bucket. Startup recovery settled that historical
bucket; the production lifecycle fix below replaces the fixture workaround.

[环境] After the presentation-ownership review, a fourth native run entered and
saved the original note editor, then verified the actual Agent query, Notes and
marker agreed without imperative refresh. Opening used the production engine's
show-annotation event rather than a pointer hit-test; typing and Update used the
actual editor controls. The deterministic late-write-ack race was not injected.
The historical fourth-run pending bucket is retained in that evidence file;
the follow-up [retirement evidence](./evidence/reading-retirement-2026-09-10.json)
records the fix and final zero-pending audit rather than rewriting that failure
as a success.

### Reading Retirement

[代码] The existing Reading close command now joins product-session retirement,
not only the animation or React teardown. `ReadingTraceCoordinator` owns one
serial persistence queue across reading generations. Each trace captures its
session/book identity, accepts both time and position observations, and samples
its final partial tick before synchronously fencing further writes. It then
waits for accepted writes and flushes only its own book's buckets. Rapid same-book
replacement queues the old retirement before any new-generation writes. A view
remount transfers the activity sampler without closing the product session;
the old 1500-ms unmount heuristic is removed. Old engine relocate callbacks also
check session identity before handing progress to current React callbacks.

[代码] `useSurfaceHandoff.closeBook()` shares an awaitable close across concurrent
callers; opening a new session rejects an old fade/retirement wait without clearing
the replacement. `ReadingSessionController.close()` joins both the shell promise
and session release. A failure can release the reader UI but rejects the actor's
promise with the stable error and presents a localized toast. A successful flush
does not hide an earlier failed time/position write; failed ticks are not claimed
durable. Rollover flush failure does not discard subsequent observations. Pending
stored buckets remain recoverable on a later open/close or startup. Cancellation
or timeout abandons the caller's wait, not the already accepted retirement, and
does not promise a rollback. No public force-flush or synthetic-time permission
is added; the event log and settled reading history remain retained.

[环境] macOS Tauri debug verified actual `navigate_reading(close)` and a real
authorized Worker close, each followed immediately by zero pending buckets. A
real SQLite `BEGIN IMMEDIATE` write lock made both actor calls reject `db/locked`;
the UI showed localized database-busy text, stored buckets survived, and reopening
then closing after lock release settled them. The fixture now asserts the close
contract rather than flushing behind it. Unit/React tests additionally cover
delayed accepted writes, sampler transfer, same-book replacement, scoped rollover,
failure continuation, concurrent close, supersession and cancellation. This is
not autonomous inference, relay/cross-device, process-kill, packaged,
Windows/Linux or long-duration/maximum-load verification.

### Derived Text State

[代码] Library 1.2 adds `queries.books.getTextState(bookId)` returning
`BookTextSnapshot`. `library:read` exposes the query; `library:write` includes
that read view; no library permission exposes neither. Agent
`get_book_text_status` uses the same owner in book and global scopes, defaulting
to the current book only in book scope. Reading status never starts parsing,
downloads a missing file, or writes a derived record.

| Field | Current meaning |
| --- | --- |
| `bookId`, `contentVersion` | Book identity and current locally available `sha256:` source version; null when unavailable or virtual |
| `status` | `unprepared`, `preparing`, `ready`, `partial`, `unsupported`, `unavailable`, `error` |
| `text` | `unknown`, `available`, `textless`; independent of preparation status and indexed chapter count |
| `chapterCount` | Finalized chapters only; zero while partial/preparing |
| `progress` | null before section discovery; otherwise `total/completed/failed/unsupported` counts required source sections, not chapters |
| `errorCode` | Optional stable failure code, never the raw parser/database error message |

[代码] `ready` requires a nonempty set of required linear sections, successful
reads of every section, and a durable finalized index. Only successful empty
reads of every required section prove `textless`. A short text can be
`ready/available` with zero chapters: the existing minimum 40-character merged
chapter policy remains unchanged to avoid silently renumbering chapter/digest
references. This API does not describe live exact-location search or book memory.
Virtual derived indexes and sections with no supported reader are `unsupported`,
not textless. Missing local source is `unavailable`; a nonexistent book rejects
with `library/book-not-found`. Database query failures reject rather than becoming
an empty state. Known section codes survive; otherwise failures use
`library/text-extraction-failed`. Unsupported extraction uses
`library/text-unsupported`. Both have localized copy in all eight locales.

[代码] Native `booktext:<id>` records are v5, with source version, required section
indices, successful pieces, failed indices/codes, unsupported indices and an
explicit `finalized` bit. A last-section checkpoint is not yet a final index.
Validation rejects malformed, overlapping or wrong-source records; v3/v4 are
invalidated lazily, not declared complete by migration. Retries reuse only
successful pieces for the same source/section layout. Five consecutive failures
stop work without claiming unvisited sections. Partial chapters are not published
to Agent/digest consumers. Per-section observation has constant-size payloads;
text is sorted/copied at adaptive checkpoints and finalization, not every section.

[代码] All callers share the repository job for a book/source; version changes
abort old work and invalidate old cached chapters. Writes/deletion serialize per
book in this process; queued writes recheck source and job ownership before/after
native persistence. Delete aborts the job and queues cleanup behind any dispatched
write. This is not a global native transaction or an engine-level force-abort.
Cold PDF TOC queries start background preparation and return promptly; a completed
cache is returned immediately. Background failures are logged and visible through
status. Setup/parser/write errors outside checkpoints are in-process state, not
durable task history across restart. Old inaccurate digest references are not
retroactively repaired by this change.

[代码] Text Desk 0.2 composes book listing, read-only state, reader header/command
views and explicit `reading.openBook`. Each page queries status for at most 20
books; book listing itself is not native-paged. Failed status rows remain visible,
detail failures propagate to the host error surface, refresh replaces the view,
and Open closes only after navigation succeeds. It is a source plugin, not added
to the Rust bundled list. It additionally consumes the task controls below.

[环境] Isolated macOS debug Tauri verified both actual Agent scopes, three real
Worker permission views, no derived blob after status-only inspection, injected
section failure with native persistence and successful-only retry, real short
FB2/normal FB2/blank PDF extraction, source removal/hash invalidation and the
compiled Text Desk menu/detail/open flow. Fault injection is at the parser
section boundary, not a native disk permission failure. Repository tests cover
write failure, deletion/source races, concurrent PDF work and final-checkpoint
restart. Durable setup error history, virtual indexing, all formats, release and cross-platform tests
remain incomplete. See [evidence](./evidence/book-text-state-2026-09-09.json).

### Persisted Reading Time

[代码] Reading 2.7 adds `queries.stats.time(query?)` and
`events.observeTime(query, handler)` for `reading:read` and `reading:write`.
Without reading permission, neither entry is exposed. They do not accrue time, move a reading
position, force a session flush, or write events. Existing `stats.forBook/list/overview`
remain settled-only. The shared native `reading_time_snapshot` reads settled
projections and device-local pending buckets in one SQLite read transaction,
including when another connection flushes concurrently.

| Field / rule | Contract |
| --- | --- |
| `bookId?` | nonblank string, at most 256 UTF-16 units; specified missing book rejects `library/book-not-found`; omitted means aggregate |
| `localDay?` | valid `YYYY-MM-DD`; matches the calendar label recorded by each session, not a conversion into the current timezone |
| `limit?`, `after?` | default 50, integer 1–100; keyset cursor `{bookId, localDay, localHour}` with hour 0–23, validated against specified scope; order by those three fields |
| `bookId`, `localDay` | accepted scope, omitted input returned as null |
| `settledMs`, `pendingMs`, `totalMs` | entire scope, never just the returned page; total is settled + pending; exact nonnegative JSON integers |
| `pendingBucketCount` | entire scope, including zero-time buckets that carry an observed position |
| `observedAtEpochMs` | native wall clock sampled inside the read transaction; not a revision or globally monotonic clock |
| `pending[]` | bounded `{bookId, localDay, localHour, ms, startedAt, lastAt, positionAt}`; lastAt can advance on ticks, positionAt only on page turns and is nullable; no locator/progress payload |
| `nextCursor` | last returned key when more rows exist, otherwise null; subsequent pages are live, not a frozen multi-page snapshot |

[代码] Totals must not be added across pages. A bucket flushed between pages may
disappear; the returned totals remain consistent within each response.
Stale projections reject `reading/stats-stale` instead of returning incomplete
statistics. Invalid input rejects `reading/invalid-time-query`; invalid aggregate
range rejects `reading/stats-invalid`; an unavailable native clock rejects
`reading/stats-unavailable`. SQLite failures preserve normalized error codes.
Recovery/unavailable errors have localized retryable descriptions; invalid
input/data and observer-limit errors do not. The query does not invent a zero
result on read failure.

[代码] `observeTime` immediately samples, then waits at least one second after
the native read and asynchronous consumer callback finish before sampling again.
It emits `{revision, status:"ready", snapshot}` or
`{revision, status:"error", errorCode}`. Revision starts at 1 per subscription,
including failed reads. At most 64 observers are active across the host; overflow
rejects `reading/stats-observer-limit`. Input/cursor are copied, polls never
overlap within a subscription, slow callbacks apply backpressure, and disposal
is idempotent, cancels the next timer and ignores late results. Already-issued
native reads are not aborted. Plugin activation cleanup tracks the subscription;
live view departure/close disposes it. This is sampled observation, not a replay
feed or exactly-once event delivery.

[代码] Agent `get_reading_time` is registered in both scopes. Book scope defaults
to the current book; `allBooks:true` explicitly selects aggregate. It exposes the
same day/keyset filter with default/max 10 buckets to bound model output, formats
durations as seconds and observation clocks as ISO UTC, preserves a nullable
positionAt, and checks cancellation before and after the read. JSON-escaped IDs
can further shorten a page to fit 16,000 characters; the cursor moves to its last
returned bucket so no entry is silently skipped. It does not flush.
The underlying reader normally persists active time on a 20-second tick; elapsed
time still only in the tracker is not extrapolated. Pending means local,
provisional time not yet in the event-sourced settled projection, not proof of
cross-device synchronization or continuous wall-clock reading.

[代码] Reading Goals 0.2 composes the query and observer with the shelf menu,
command palette, book-goal detail action, day/all-time filters, pending keyset
list/detail and UI 1.2 live publication. Main detail updates automatically;
pending list uses explicit refresh. It requires views 1.2, which adds the
`{kind:"error", code}` block. The normalizer accepts only 1–128 characters matching
`^[a-z0-9][a-z0-9/-]*$`, drops extra fields, and rejects invalid blocks. The host
renders `InlineError` with localized `describeError` copy; unknown valid codes
use the safe generic fallback, never plugin raw text. No error dialog or automatic
retry action is introduced. A failed live read retains the last successful sample
with an explicit stale label; subsequent success removes the error. Initial
action/query failure propagates to the existing host failure surface.

[环境] Isolated macOS debug Tauri verified no/read/write permission Workers,
two pending keyset pages, both production Agent scopes, a controlled 25-second
flush with unchanged total, stale-projection error and automatic recovery,
subscription disposal, compiled Reading Goals menu/day/empty-list flows, and
800x650 layout without horizontal overflow. Actual foreground FB2 reading
produced 20.001 then 40.003 pending seconds; closing settled 43.7 seconds including
the partial tick. The 25-second setup was synthetic native accrual, not real
reading. Rust tests cover WAL concurrent read/flush and racing ticks. Autonomous
model decisions, long-running load, packaged builds and Windows/Linux are not
verified by this evidence. See [evidence](./evidence/reading-time-snapshot-2026-09-09.json).

### Settled Reading Insights

[代码] Reading 2.8 adds `queries.stats.insights({bookId?, period?, asOfDay?})`
under `reading:read` (also included in write). No permission means no reading
domain. `bookId` follows the time-query nonblank/256 UTF-16-unit contract;
omitted means aggregate. `period` is `week` (default), `month`, `year`, or `all`.
`asOfDay` is a valid `YYYY-MM-DD` calendar reference (year 0100 or later),
defaulting to the current local day. Invalid input rejects
`reading/invalid-time-query`; a specified absent book rejects
`library/book-not-found`; stale projections reject `reading/stats-stale`.
Other native failures retain their normalized codes, never an empty fallback.
Calendar helpers preserve four-digit keys and explicit full years, including a
window crossing 0100 into 0099; JavaScript's numeric-date 1900 offset is not used.

[代码] `reading_time_scope` reads totals/daily/hourly in one SQLite transaction.
The host derives the same facts as the statistics UI, rather than maintaining
a plugin-specific calculation. This is settled-only: no pending rows, clock
extrapolation, mutation, or flush. The response is:

| Fields | Meaning |
| --- | --- |
| `bookId`, `source`, `period`, `asOfDay` | accepted book or null, literal `settled`, selected period and reference day |
| `totalMs`, `daysRead`, `booksRead`, `avgPerDayMs` | selected-period time, positive-reading days/books, average over active days (rounded milliseconds) |
| `deltaRatio` | change versus preceding equal window; 0.5 means +50%; null for all-time or zero preceding time |
| `bars[]` | `{key, ms, isCurrent}`; 7/30 day bars, 12–13 calendar-month bars intersecting the 365-day window, or at most 36 recent calendar months for all-time |
| `weekdayMs` | seven period-scoped totals, Monday first |
| `allTimeHourlyMs` | exactly 24 all-time local-hour buckets, never period-scoped |
| `achievements` | all-time `totalMs`, `currentStreak`, `longestStreak`, `bestDayMs`, nullable `bestDayKey`, `daysRead`, `booksRead`, nullable `mostReadBookId`, `mostReadBookMs`, nullable `nextMilestoneMs` |

[代码] Week/month/year mean trailing 7/30/365 days including the reference day,
not calendar week/month/year. Year bars now clip the same daily window as the
headline instead of including out-of-range days from full months. Existing daily
queries remain available for plugin-defined heatmaps. All-time bars are bounded,
so they need not sum to lifetime time. Day/hour labels remain recorded local
labels; the projection has no day-by-hour joint distribution. `asOfDay` is not a
past database snapshot: all-time achievements/hours can include later records.
Aggregate history includes removed books whose reading records remain, so
`booksRead` is not current shelf size. The statistics UI no longer automatically
writes synthetic history in development; Storybook keeps its own fixtures.

[代码] Both Agent scopes expose `get_reading_insights`, defaulting to the current
book in book scope; `allBooks:true` selects aggregate. Output durations are
seconds, weekdays are explicitly Monday-first, and hour/achievement fields are
named `allTime...`. Cancellation is checked before and after the native query,
not represented as cancellation of an already-issued SQLite read. Bounded
36-bar/24-hour/7-weekday output, including maximally escaped valid IDs, is tested
below 16,000 characters; internal host history loading is not bounded/paginated.

[代码] `READING_DOMAIN_EVENT_TYPES` in core is the single source for both the
runtime reading event roster and public `ReadingDomainEventType`. The canonical
`book.sessionRecorded` payload includes bookId, ms, startedAt, endedAt, localDay,
localHour and optional position. Legacy `book.timeRecorded` remains supported.
The Agent reads current facts on its next tool call; this is not a model event
subscription. Same-source typing does not establish remote change delivery,
durable replay or exactly-once semantics (see capability CON07).

[代码] Reading Goals 0.3 composes the period form, date-total list, all-time hour
list, milestones and refresh using this query. The main detail subscribes to
sessionRecorded/timeRecorded, filters book scope, coalesces overlapping refreshes
and rereads after subscribing. It never accumulates event payloads as another
statistics store. Failure retains the last successful sample with the localized
error block and stale label. Departing a live view disposes subscriptions and
suppresses late publication. Child views are snapshots; return resubscribes and
refreshes. It is not a full-source observer for deletion, remote changes or
midnight rollover; explicit refresh remains available.

[环境] Isolated macOS debug Tauri verified production Agent tools in both scopes,
real no/read/write Workers, four native settlement events, and compiled plugin
period/date/hour/milestone views. Synthetic pending 130 seconds yielded zero
settled insights; after flush the scoped week/month/year/all results were
30/100/100/130 seconds. A further real native flush of synthetic 60 seconds
updated the visible aggregate by exactly one minute. An isolated stale-projection
marker rejected both actors; an injected notification (not a log write) exercised
the live error surface. After removing the marker, a real 25-second settlement
automatically cleared the error. These synthetic samples are not elapsed user
reading; direct tool invocation is not autonomous model decision evidence.
Native tests cover transaction consistency under a concurrent WAL writer and
read-only scope validation. Large-history performance, complete all-source
observation, packaged builds and Windows/Linux remain unverified. See
[desktop evidence](./evidence/reading-insights-2026-09-09.json).

### Derived Text Requests

[代码] Library 1.3 exposes actor-owned preparation requests, not a generic durable
job engine. `library:write` includes the read surface; no permission means no
library domain. Mutations during plugin activation fail activation and roll back
registrations. Worker quiescence aborts the activation's tasks and observers.

| Entry | Permission / contract |
| --- | --- |
| `commands.books.prepareText(bookId, { rebuild? })` | write; validates book/options, returns a task receipt; default resumes/reuses, rebuild discards the derived index and rereads required sections |
| `commands.books.cancelTextTask(bookId, taskId)` | write; exact actor-generation/book binding; terminal requests unchanged |
| `queries.books.getTextTask(bookId, taskId)` | read; exact owned request snapshot, not current book status |
| `queries.books.listTextTasks(bookId)` | read; retained requests of this actor/book in creation order; maximum 64 across the owner |
| `events.observeTextTask(bookId, taskId, handler)` | read; immediate snapshot, increasing revision, disposer; asynchronous slow callbacks coalesce to latest including terminal state; callback errors are logged |

[代码] A task snapshot contains `taskId/bookId/mode/revision/status/createdAt/updatedAt/textState`
and optional stable `errorCode`. Mode is `prepare/rebuild`; status is
`queued/running/completed/failed/cancelled`. Times are ISO strings. Terminal state
is immutable; the embedded text state is the last observed operation snapshot,
not a live book-status subscription. A receipt may still be in source preflight:
it does not prove completion or acquisition of an extraction lease. A cancelled
preflight cannot start extraction, but already dispatched source retrieval is not
rolled back. Current book state is always a separate `getTextState` read.

[代码] Each request leases the same repository job after source checks. Cancelling
one releases only its lease; an already joined reader/Agent/plugin keeps the job
alive. Removing the last lease aborts logical work and guards against late
publication, but cannot forcibly undo a dispatched parser read, blob write or
download. Rebuild fails with `library/text-busy` while any existing shared job owns
that source; it does not cancel other consumers. Source change/deletion still
invalidates old work. Limits are 16 active requests per owner, 64 retained handles
including terminal history, and 16 observers per task. Old terminal handles are
evicted first and their observers stopped. Explicit disposal releases observers;
terminal observation does not automatically dispose its Worker callback lease.

[代码] `library/text-cancelled`, `library/text-busy`, `library/text-task-not-found`
and `library/text-task-limit` have localized host copy in all eight locales.
Preflight lookup/validation failures reject before creating a task. Later failures
become failed task snapshots; a failed diagnostic read preserves known progress
and logs the read failure rather than inventing an empty successful result.

[代码] Agent `prepare_book_text`, `get_book_text_tasks`, `cancel_book_text_task`
are available in book and global scopes through the actual shared domain. Both
scopes share the one process-local Agent owner; no plugin-owned tasks are exposed.
Book scope defaults to the current book; global requires bookId. List results are
newest-first `{ tasks, total, offset, nextOffset }`, default 10 / maximum 20 per
page, with nonnegative integer offset. Pages are not stable across new tasks or
eviction. Supplying taskId returns the exact snapshot instead of a page. An
alternate host without the optional preparation port does not advertise these
tools. This is not an LLM end-to-end test or per-conversation task isolation.

[代码] Text Desk 0.3 requires library:write and reading:write. Prepare returns a
request detail; Rebuild requires a checkbox confirmation with host field errors;
My requests lists this activation's handles. Cancel says "this request", never
"all extraction"; Refresh rereads the handle and replaces the view. Failures show
safe localized labels, never raw error messages. Request details now compose
`observeTextTask` with UI 1.2 / views 1.1 live publication. Closing the detail
disposes observation, not the task. Lists remain explicitly refreshed. There is
no polling or DOM access. This plugin does not contribute extra Agent tools because
the host already supplies the shared ones.

[环境] Isolated macOS debug verifies actual permission-gated Workers, activation
rejection, shared cancellation, foreign/retired handle denial, busy rebuild,
Worker shutdown, observation disposal, real FB2 rebuild, both Agent scopes and
compiled Text Desk menu/confirmation/refresh/cancel views. Held-section injection
uses the registered content boundary; storage and bridges are real. Unit tests
add source/write races, caps, slow-observer coalescing, failure propagation and
64-task Agent pagination. Explicit pause/resume/prioritization, durable history,
task-wide timeout, virtual indexing, all formats, marketplace installation,
packaged/cross-platform and physical-input validation remain outstanding. TXT05
therefore remains partial. See [task evidence](./evidence/book-text-tasks-2026-09-09.json).

### Live Plugin Views

[代码] `schemas.views` 1.1 adds optional `PluginView.live.subscribe(channel)`;
`services.ui` 1.2 adds `publishView(channel, { revision, view })`. Existing static
views are unchanged. `view` in an update is `PluginViewContent`: markdown, list,
form, blocks or detail, without another `live` declaration. This publishes a full
snapshot, not a patch, navigation result or new source. No DOM, React, Jotai,
arbitrary host callback or additional domain permission is exposed. Agent tools
continue to return structured data through their host renderer; this is not a
new model-executable UI tool or unified Agent enablement implementation.

[代码] The host calls subscribe only for the visible top frame, with a serializable
`{ id: string }` channel, and expects a disposable or Promise of one. The channel
belongs to that frame and the private Worker activation AbortSignal attached by
the bridge, not a plugin-supplied ID. A plugin cannot publish into another actor's
frame. At most 16 channels may be active per activation (`plugin/busy` beyond
that). Source authors must publish their current snapshot on each subscription
to close the initial-query/subscribe gap; Text Desk's immediate task observation
does so. Hidden parent frames, nested modal presentation, suspension and close
retire channels immediately and invoke the subscription disposer asynchronously.
Back/resume creates a fresh channel. A late subscription acknowledgement is still
disposed. Stopping a view source does not cancel business work unless its own
explicit disposer contract says so; Text Desk only stops observing.

[代码] `revision` is a nonnegative safe integer, monotonically increasing within
one channel; the initial accepted revision may be zero. The receipt is
`{ status: "applied" | "stale" | "inactive" }`: applied means accepted into the
host view session, not React commit, pixel paint or durable data completion.
Equal/lower revisions return stale without applying content. Unknown, foreign
and retired channels uniformly return inactive without exposing existence.
Malformed channel/revision or view declarations reject with `plugin/invalid-input`.
For an active channel, invalid view content also stops the subscription and
preserves the last good view with localized InlineError. Subscription failures
behave the same way; Retry is offered only when `describeError` marks the failure
retryable. Cleanup failures are logged. The existing RPC bounds remain 256 pending
calls per direction and 120-second deadlines; this is not a durable stream or
an exactly-once delivery guarantee. There is no built-in source throttling.

[代码] Live updates preserve the frame identity, allowing the existing form
draft reconciliation to retain edited fields and allowing an in-flight action's
valid navigation to complete. Normalized callbacks are held by leases. The
currently painted snapshot survives until React acknowledges its replacement;
only it and the latest unpainted snapshot are retained, with intermediate update
callbacks released. Ordinary Worker API arguments now use transferable leases
instead of forced release at RPC completion. Each overlapping owner watcher uses
its own listener identity so releasing the previous view cannot remove the new
view's retirement listener. Closing/unloading the owner still retires the view,
including callback-free content. No guarantee is made for preserving drafts when
the field schema or view kind fundamentally changes.

[环境] [Live-view evidence](./evidence/plugin-live-views-2026-09-09.json) records
isolated macOS debug tests using actual WebKit Workers and the app renderer:
foreign publication, stale revision, updated button callback, retained user draft,
push/back/modal source disposal, fresh resubscription, invalid content, late ACK,
closed channel and activation retirement. Compiled Text Desk 0.3 opened from the
reader More menu and advanced from Running 0/3 to Completed 3/3 without Refresh;
the cancel action disappeared. Only a registered section getter was held; native
book source, task repository, SQLite/blob persistence and RPC remained real.
1200x800 and 800x650 screenshots were inspected. Unit tests additionally bound
100 successive update callback graphs and cover invalid disposers and subscription
failures. Interactive contribution state is implemented below; general host Agent enablement, all form
schema/focus/locale interactions, large payloads, physical input, marketplace
install/upgrade, packaged and Windows/Linux remain unverified or unimplemented;
MORE05 remains partial, not closed by live views alone.

### <a id="interactive-contribution-state"></a>Interactive Contribution State

[代码] `commands`, `headerActions`, `selectionActions` and `agentTools` are at
contribution version 1.1. Their optional initial `state` and returned
`PluginActionRegistration.updateState(state)` share a full snapshot:
`{ revision, visible, enabled, checked? }`. Omission at registration means
revision 0, visible/enabled true and no checked value. Revisions must be
non-negative safe integers; booleans are validated. Omitting checked in a later
snapshot removes checkable presentation. There is no partial merge or automatic
toggle. Missing/malformed update payloads fail with `plugin/invalid-input`.

[代码] State is owned by the exact registration, not its public ID. A valid newer
snapshot returns `applied`; equal/older revisions return `stale`; replaced,
disposed and unknown handles return `inactive` without revealing another owner.
Worker handles wait for the registration ACK and remain usable after `await`;
dispose-before-ACK prevents subsequent updates. The host only accepts the four
mutable contribution handle types from that Worker's held registrations. Updates
require active lifecycle phase and use existing RPC limits/deadlines. No grant,
business state, persistence or render-completion guarantee is added.

[代码] Hidden entries are removed from runtime menus and the command palette;
disabled entries remain visible but inert. Checked presentation uses accessible
pressed/checked semantics. Keyboard palette navigation skips disabled results,
including the all-disabled case. User menu placement and shortcut customization
continue listing registrations: hiding a menu placement is not revoking a command.
Every invocation of a registered callback rechecks registration ownership and
current visible/enabled state, including old UI closures and cached Agent tools.
Unavailable actions reject with `plugin/action-disabled` (eight localized copies);
retired registrations reject with `plugin/unavailable`. Tool discovery filters both
book/global scopes. AgentThread refreshes the complete scoped tool snapshot before
each model request, including the first request of a reused thread and subsequent
tool-loop requests. It uses pi's supported `prepareNextTurnWithContext` to replace
both discovery and execution context, not only the provider's advertised schemas.
Tool/retrieval registration changes no longer discard the cached chapter session.

[代码] An outstanding model request keeps its original definitions and callbacks.
Disabling or replacing a registration while that request is pending does not send
its old call to the new implementation. Execution checks reject it; the next model
request discovers the current toolset. Retrieval tools also check exact current
registration identity and reject retired providers with `plugin/unavailable`,
including when the same definition object is registered again. Already-started
operations are not cancelled by this refresh. Scope, turn permissions, spoiler
state, message history and result compaction remain governed by existing policy.
This is not unified availability for all host built-in operations.

[环境] [Tool-loop evidence](./evidence/agent-tool-refresh-2026-09-09.json) records a
real isolated macOS Tauri Worker and product AgentThread across nine model requests:
arm a disabled tool, execute it, disable during an outstanding response, re-enable
in the same user turn, replace the same name during the next user turn, then execute
the new registration. Only three target side effects occur; both stale invocations
fail and previous conversation remains. Inference is a scripted stream, conversation
ports are in-memory, not autonomous remote-model or SQLite persistence evidence.
Unit tests cover both book/global loops, between-user-turn refresh and retired
retrieval providers. Packaged/Windows/Linux and continuous load remain unverified.

[代码] State changes do not cancel operations that already started or revoke
callbacks in a view already opened by an action. Disabling an open page/popup does
not reload its source or reset drafts. Hiding removes mounted header entries and
exits a hidden full page; an independently opened dialog is not that entry and
remains under its own view/activation lifetime. Domain grants still apply to its
actions. A callback's private activation identity survives host execution guards.

[代码] Jumper 0.2 composes `reading.events.observeSession` with these handles:
open/header require a ready session; back/forward additionally require the host
history flag. Initial entries are disabled until the first observed snapshot.
Jumper never owns a second history or infers readiness from menu visibility.

[环境] [Action-state evidence](./evidence/plugin-action-state-2026-09-09.json)
records actual isolated macOS WebKit Workers, shelf/reader menus, command palette,
selection toolbar, keyboard listener, retained page draft, cached Agent tool and
an in-flight tool surviving disable. Compiled Jumper followed real FB2 navigation,
back/forward and close/reopen state. Screenshots at 1200x800 and 800x650 were
inspected. Tests cover replacement, malformed/stale updates, owner abort and
dispose-before/after ACK. Native inputs were MCP-dispatched DOM events, not
physical keyboard/mouse. Host built-in Agent availability, continuous load,
marketplace install/upgrade, packaged and Windows/Linux remain outstanding;
MORE05 is still partial.

### Batch Book Removal

[代码] Library 1.5 exposes `commands.books.removeMany(bookIds)` and
`commands.books.retryRemovalCleanup(bookIds)` to `library:write` plugins.
Both accept 1-1000 nonblank string IDs, each at most 256 characters; inputs are
copied and deduplicated without coercing or trimming IDs. Invalid input rejects
with `library/invalid-removal` before writes. Empty batches are not silent no-ops.

[代码] `removeMany` commits all `book.removed` events and projections in one
SQLite transaction. Database failure rejects the call with no removal notification
or file release. After commit, observers receive removal events before separate
source-file/cover cleanup, so a file failure cannot leave the shelf pretending the
records still exist. The returned `{ bookIds, committed: true, files }` distinguishes
`files.status: "released"` from `"pending"` with a stable `errorCode`. File cleanup
can be partially applied; it is not part of the record transaction. Observer
exceptions are logged and do not suppress remaining notifications or cleanup.

[代码] `retryRemovalCleanup` returns `{ bookIds, files }` without appending any
record-removal events. The native command holds the database lock and checks
**all** IDs before releasing any file; a current book yields pending
`library/book-reappeared`. Other failures retain their stable code; unknown errors
use `fs/unknown`. This guards restored books, not arbitrary cross-device CAS.
Direct batch removal remains idempotent for absent IDs and may append another
removal event; use the file-only method for cleanup retries. Legacy single
`remove` keeps its void/error contract and can reject after records committed.

[代码] The global Agent tool `delete_books` uses the same domain and freezes a
copied, deduplicated batch before one approval displaying every title. New removal
rejects unknown IDs before approval; `cleanupOnly: true` refuses current books and
uses file-only retry. Decline and cancellation before dispatch do not mutate;
abort does not undo a dispatched database transaction. Book scope deliberately
does not expose this global administration tool. Plugin domain grants allow direct
writes and do not imply per-operation host approval.

[代码] Library Desk 0.2 composes queries, live list selection, full-title review,
batch deletion, durable cleanup discovery and safe retry through public APIs. It requires library 1.6
and library:write. List refreshes keep the current search query; explicit navigation
uses the host frame identity. Older refresh results and disposed views cannot
publish over newer content. Its review is plugin UX, not a host authorization
ticket. It is a source plugin, not one of the six Rust bundled plugins.

[环境] [Native evidence](./evidence/book-batch-removal-2026-09-09.json) covers
isolated macOS debug Tauri: no/read/write Worker grants, invalid input, both actors'
second-event rollback, pending file release, file-only retry without new events,
restored-book preflight preserving both files, Agent rejection/cancellation/success,
and actual shelf-menu Library Desk review/delete/retry at 1200x800 and 800x650.
Agent tests invoke the production tool/ports and real approval component in a
fixture surface, not an autonomous model or persisted chat turn. This is not full
data erasure: private plugin documents, chats, memories, derived indexes and remote
blob lifecycle have separate owners. The recovery evidence below is separate from
this original batch test. 1000-item rendering/load,
packaged CSP, Windows/Linux and cross-device races remain unverified.

### Durable Book File Cleanup

[代码] Library 1.6 adds `queries.books.listRemovalCleanup({ after?, limit? })`
for `library:read` or `library:write`. No library grant means no library object.
The global Agent tool `list_book_removal_cleanup` delegates to the same domain,
checks cancellation before/after reading, and neither writes nor requests approval.
Book-scoped Agent tools intentionally do not expose the global backlog. Discovery
returns `{ items: [{ bookId, title, removedAt }], nextCursor: string | null }`.
Limit is an integer 1-100 (default 50); an optional cursor is a nonblank book ID
of at most 256 UTF-16 code units, preserved without trimming. Invalid input uses
`library/invalid-cleanup-query`. IDs are ordered lexically; pages are live keysets,
not a frozen snapshot. Concurrent new entries before a cursor require a fresh scan.

[代码] SQLite migration 31 creates device-local `book_removal_cleanup`. An
`AFTER DELETE ON books` trigger saves ID, last title and local deletion time in
the same transaction that removes the record. Record rollback also rolls back
the intent. An `AFTER INSERT ON books` trigger cancels that ID's intent when a
book is restored. The queue is not an event projection, synced state or checkpoint
payload; replay deletions can enqueue, and surviving reinsertions cancel them
inside the replay transaction. Factory reset clears the queue after book deletion.
It does not reconstruct orphan files from deletions before migration 31.

[代码] `library_list_removal_cleanup` and `library_release_book_files` reject
stale projections with `library/cleanup-stale`, rather than treating a temporarily
missing projection as permission to erase files. Release preflights every ID under
the database lock. Blob metadata and intent acknowledgements commit together;
physical file deletion is not transactional. A failed batch retains all its intents
even if some bytes are already gone; retries tolerate missing bytes. No additional
`book.removed` event is written. The existing single-book void/error contract is
unchanged, but its actual record deletion also creates durable recovery intent.

[代码] Native startup performs one recovery pass after staged-sync recovery,
in keyset pages of 100, releasing the mutex between entries. A failed entry logs
and remains pending without starving later pages. Stale projections defer the pass.
This is not a periodic scheduler or general durable task service; explicit retry
and the next startup are the remaining recovery opportunities. Library Desk's
Pending file cleanup action lists 50 entries per page, displays the full stored
title and ID in detail, and retries only that ID. Its refresh action re-queries;
discovery does not depend on the plugin retaining the original removal receipt.

[环境] [Recovery evidence](./evidence/book-removal-recovery-2026-09-09.json)
records isolated macOS debug restarts, fresh no/read/write Worker consumers,
production Agent discovery/approved file-only retry, and real Library Desk menu
discovery/detail/retry. Binding loss for a synthetic virtual book does not erase
the host cleanup intent. That virtual case injects intent acknowledgement failure
without source bytes; it is not a virtual-file I/O test. General RSS private-cache
cleanup, binding persistence recovery, late blob writers, cross-device races,
packaged and Windows/Linux remain outside this evidence.

### Versioned Range Reads

[代码] Library **1.7** exposes `queries.books.readRange(input)` to
`library:read` and `library:write`; no library grant means no entry. Precise
`searchLocations` hits now carry `range` as well as their navigable `location`.
Both are data references, not permission tokens. The Agent's `read_book_range`
tool is registered in global and book scopes and uses the same host implementation.

- Range identity: nonblank `bookId` (max 512), `contentVersion` (max 256), and
  `cfi` (max 8192); optional `textQuote.exact` (nonblank, max 12000) and optional
  prefix/suffix (max 2000 each). The host copies the input before awaiting reads.
  Unknown keys at every level are rejected, including injected `hrefs`, grants,
  and chapter ceilings. References are checked against the source version both
  before and after reading; missing books/files/providers are not empty passages.
- Query bounds: `offset` is a nonnegative safe integer, default 0; `limit` is
  2–12000, default 4000; `contextChars` is 0–2000, default 240 per side. Offsets
  count UTF-16 units in the resolved range, never extracted chapter offsets.
  Offsets splitting a surrogate pair or beyond the range reject; chunk/context
  boundaries avoid splitting pairs. `offset === totalLength` is an exhausted
  empty page. `nextOffset` is null only when the range is exhausted.
- Result: normalized `range`, `sectionIndex`, `text`, `offset`, `totalLength`,
  `nextOffset`, and `context.before/after`. Context is outside the **whole**
  range, not outside the current chunk, and never crosses its source section.
  DOM text follows the engine text walker (no script/style); it is not a sentence
  segmenter or a reconstruction of visual paragraph spacing. A large section
  still materializes source text/context internally: bounded output is not
  bounded parsing memory or preemptible synchronous work.
- DOM ranges require canonical, single-document engine CFIs with noncollapsed
  text. An optional quote verifies the resolved range; it cannot relocate a
  mismatching CFI. Text-only sections such as PDF require a canonical page CFI
  plus a unique quote, with whitespace/soft-hyphen normalization. Multiple
  matches reject rather than taking the first. The shared View CFI resolver now
  treats a page CFI as a section target with no fabricated local path, fixing
  PDF search-result navigation before the rendered quote is resolved.
- Stable codes: `library/invalid-range`, `library/range-not-found`,
  `library/range-ambiguous`, `library/range-unsupported`,
  `library/range-forbidden`, plus existing source/version errors such as
  `reader/stale-location`. All five new codes have copy in eight locales.
- Agent current-book reads retain the turn's original narrative ceiling,
  including surrounding context. The host resolves allowed chapter hrefs to
  sections and checks before the target document/text load. `confirmSpoiler`
  requires a host-verified grant; a returned range does not grant access. Global
  and other-book policy is unchanged. Only returned text/context enters evidence,
  as separate pieces rather than fabricated adjacency across a paginated range.
- Plugin `getNavigationToc`, `searchLocations`, and `readRange` now use the
  lifecycle read barrier: cancellation immediately rejects the consumer with
  `plugin/cancelled`, while shutdown drains the actual source operation and its
  lease. Non-interruptible parser/IPC work is not destroyed underneath the read.
  Expected cancellation is not a shutdown failure; late source/cleanup failures
  remain logged and reported. This is not a guarantee that a hung parser finishes
  by a deadline, nor a retrofit of every unrelated plugin query.

[代码/消费者] Text Desk **0.5** requires library 1.7. Its per-book Find a
passage form accepts an exact query (1–500 characters), case/whole-word options,
and paginated search batches. Selecting a result reads a versioned passage
without moving the reader; the explicit Open passage action navigates to that
range. Duplicate excerpts have section/occurrence labels. Details show a quote,
bounded surrounding text, offsets and continuation; stale/failed reads reject
instead of constructing a successful detail. Existing derived-index search
remains separate and does not pretend its offsets are ranges.

[环境] [Range evidence](./evidence/book-range-2026-09-10.json) records real
macOS debug Tauri, native imported FB2/PDF, permission-gated module Workers,
eight concurrent reads per format/permission, actual Agent tools/fence and the
compiled Text Desk UI. Native navigation reached the second PDF occurrence
with `visibleText: needle`; actual reader state was unchanged by range-only
reads. A held native parser load outlasted the old two-second quiescence timeout:
RPC cancelled first, shutdown remained pending, and the final lease released
once before successful termination. The load delay is an explicit fixture, not
a measured production IO latency. An earlier PDF failure and quiescence timeout
are retained as regression evidence. Deleting a book before opening a stale hit
logged `library/book-not-found` and produced no successful detail; the transient
toast was not captured, so no visual error-copy claim is made for that case.
Autonomous LLM decisions, packaged/Windows/Linux, maximum payload/long-lived
load, provider content replacement, and remote source mutation are not verified.
Persisted annotation anchors and Range writes are not unified; TXT10/TXT13
therefore remain partial. Captured selection/guide reads are specified below.

### Captured Selection Ranges

[代码] Reading 2.9 adds `session.selection` to queries and observations. Null
means no captured selection. A snapshot has a capture `id`, normalized `text`
preview (at most 12000 UTF-16 units without cutting a surrogate pair), full
normalized `textLength`, and `range: BookTextRange | null`. The range binds the
displayed parser's book and content version synchronously at capture time, not
the version when a later action happens. Unavailable ranges retain copyable
preview text and report `rangeUnavailableReason`: `unavailable` for absent or
different parser identity, `too-large` for PDF exact quotes over 12000 units,
or `unsupported` for a failed portable anchor. No range is truncated into a
different passage. DOM captures use the source CFI; PDF captures use page CFI
plus exact text and up to 80 source-text-layer characters on each side. A
later read checks uniqueness and current source version; capture itself is
not proof that later extraction will succeed.

[代码] Host feedback accepts only the ready matching session/book/version and
copies values. Relocation, renderer detachment, failure, replacement and close
clear the public selection; native Escape publishes its clear. Late capture
checks document membership before clearing or replacing state. This is not a
general fix for all document listeners. Public writes are specified below.

[代码] `selectionActions` 1.2 adds optional `input.range` (the current host sends
a range or null). Native selection uses the captured reference. Guided reading
uses its already versioned `position.location` only while book/CFI match the
current unit. Legacy annotation targets return null: attaching today's version
to their old CFI would fabricate provenance. The existing `cfiRange` and
`context` fields remain for local presentation/lookup; neither is new authority.

[代码] Agent `get_reading_session` returns this snapshot under the existing
active-book and reading-context policies. Either selection/surrounding sharing
restriction withholds the whole selection, including PDF quote context. An
unapproved original turn spoiler fence also withholds it; later navigation is
not permission. `read_book_range` retains its separate source/fence validation.
Plugins require reading access for session queries/observations and library
access for source reads; a contribution input does not grant either domain.

[代码/环境] Text Desk 0.6 composes the captured range from its selection/guide
menu contribution, or reads the current selection from its header view action,
then uses ordinary range detail and explicit navigation. No range gives a
non-actionable unavailable detail, not a guessed search or restamped anchor.
[Native evidence](./evidence/selection-range-2026-09-10.json) covers real FB2/PDF
DOM selections, module Workers with no/read/write grants, session observation,
actual Agent session-to-range tool composition, compiled menu details, guided
paragraph detail, native Escape and switch clearing. Selection was created via
DOM Range and dispatched pointerup, not an OS mouse drag. The detached-document
event had no live Selection, so it does not prove the nonempty stale branch.
Privacy combinations are unit evidence, not native preference-toggle evidence.
Annotation creation/validation/persistence, all-format and packaged/cross-platform
coverage remain incomplete. Public selection commands are specified below.

### Selection Control

[代码] Reading 2.10 exposes `commands.selectRange(range, guard?)` and
`commands.clearSelection(expectedId, guard?)` to plugins with `reading:write`.
No/read grants do not expose commands. Both actors share the reading controller;
Agent `set_reading_selection` has `select` with a copied BookTextRange or `clear`
with a previously observed selectionId, never both. Select requires the target
book already ready, validates the source before navigation, checks content
version/session identity, restores a rendered DOM range (PDF: unique quote),
and joins its matching React overlay commit. This is not a compositor/animation
completion guarantee. Clear requires the exact selection identity and waits for
the matching null commit. Newer user selections, renderer replacement and stale
guards reject rather than clearing a replacement selection.

[代码] Selection presentation has a 10-second deadline; select also shares the
navigation deadline, cancellation and intent ordering. Plugin retirement forwards
its lifecycle signal. Cancellation rejects the receipt; it does not roll back
an already moved viewport or displayed selection. A source failure happens before
movement, while a later rendering failure may occur after movement. Agent returns
only status/sessionId/selectionId, not text. Under privacy/spoiler restrictions,
`get_reading_session` removes selection and visibleText plus textQuote from both
current location and mode position. The model must still use authorized range
reads for text. Navigation now accepts exact quotes up to the producer's 12000
UTF-16 limit rather than rejecting otherwise valid 8193-12000-unit references.

[环境] [Native evidence](./evidence/selection-control-2026-09-10.json) covers
real FB2/PDF module Worker select/clear, no/read grant absence, stale clear
preserving a newer selection, actual Agent tool select/clear and stale version
rejection. Compiled Text Desk 0.7 composes search/read/select and a captured-ID
clear action; native dialog button clicks selected the second PDF match, then
the dialog exited with its selection toolbar still visible. Both owned books,
their annotations, cleanup intents and live blob paths were removed through
formal commands and checked with read-only SQLite. Existing books were untouched.
Unit tests cover source/guard rejection, delayed validation and React commit,
replacement/cancellation/timeout, privacy redaction and consumer completion.
Native in-flight cancellation, all formats, long ranges, stale nonempty documents,
provider replacement, packaged and Windows/Linux remain unverified; READ13 stays
partial rather than treating this command pair as the complete capability goal.

### Derived Prose Search

[代码] Library 1.4 adds `queries.books.searchText(input)` under `library:read`
or `library:write`. No library grant means no library object. The production
Agent BookTextPort delegates to the same domain operation; pure chapter and
conversation matchers now live in core, with existing Agent exports retained.

- Input: `queries` contains 1–12 nonblank case-sensitive strings, each at most
  1024 characters before trimming; duplicate trimmed variants collapse. Optional
  `bookId` must be a nonblank string. Optional `throughChapterIndex` is a safe
  integer at least -1 and requires a book. -1 returns no chapters; larger values
  are inclusive ceilings. Optional `limit` is 1–100, default 16.
- Invalid input rejects with `library/invalid-query` before storage reads. A
  missing specific book rejects with `library/book-not-found`; read/preparation
  failures propagate, never become an empty or partially successful array.
- Specific-book search uses the shared extraction repository and may prepare
  text. Shelf search reads only persisted, source-valid local indexes in current
  library order, skipping absent indexes. It stops once the result limit is met;
  it does not start bulk extraction or promise a complete shelf search.
- Result: `{bookId, chapterIndex, chapterTitle?, offset, snippet, match}`.
  Offset is a UTF-16 character position in extracted chapter text, NOT CFI,
  Location, Range, or a content-version-stable anchor. `match` is `exact` or
  `partial`. Existing matching, per-query caps and 200-character bucket dedupe
  remain: at most three exact hits per chapter/query; token fallback only when
  that query has no exact hit in the searched book. This is not global relevance
  ranking or an exhaustive occurrence count. Snippets include up to 160
  characters on each side and optional ellipses.
- Agent retains current-book defaults and its host-verified spoiler ceiling;
  the UI plugin does not gain access to the Agent's spoiler permission state.
  The tool returns up to 16 hits and records snippet evidence as before.
- The Agent forwards its abort signal; the plugin passes its activation
  lifetime. Cancellation is checked before work and after awaited reads, reports
  `library/cancelled`, and prevents late results. It does not undo extraction or
  interrupt synchronous matching within a large chapter. Pagination, scan
  budgets, task handles and cooperative cancellation remain TXT08 work.

[代码] Introduced in Text Desk 0.4 (now 0.5, requiring library 1.7), this flow composes the existing library,
reader, form/list/detail surfaces: shelf-index search, selected-book search,
newline-separated variants, 40-hit result limit, exact/partial labels, plain-text
snippet detail and explicit Open book. Opening a book does not pretend to jump
to the snippet. Empty copy refers only to the searched index. Form validation
preserves the input; host failures propagate to the host error surface.

[环境] The isolated macOS debug evidence is
[book-text-search-2026-09-09.json](./evidence/book-text-search-2026-09-09.json).
Real permission-gated Workers verify no-grant/read/write views, single/shelf
matches, invalid input, missing books and -1 ceilings. Product Agent tools with
real ports verify global hits and the current-book spoiler fence. An unprepared
book remains unprepared after shelf searches. No autonomous model invocation,
packaged build, Windows/Linux, sustained load or native mid-scan cancellation is
claimed. Unit tests cover input bounds, storage failures and abort boundaries.

### Virtual Book Removal

[代码] `library.commands.books.removeVirtualBook({ providerId, key })` resolves
only the calling plugin's binding after earlier local KV writes settle. It awaits
the shared library deletion and propagates failure instead of unbinding and
returning success. It then waits for the exact binding cleanup write, or observes
that the shared book-removed listener already completed it. A changed binding is
not removed and rejects with `plugin/unavailable`. Invalid registry JSON or entry
shape rejects with `db/error`; it is not an empty registry and cannot be overwritten
by a bind/unbind operation.

[代码] This is an ordered operation, not an atomic transaction across event-sourced
books, source blobs, device-local bindings and plugin documents. If deletion
committed but cleanup failed, the book remains deleted and the operation rejects;
an explicit repeat can finish pending binding cleanup. Since library 1.5, the
book-removed notification follows the record commit even when file release fails:
the binding may already be absent in that case. Repeating removeVirtualBook then
does not retry files. Since library 1.6, callers can rediscover the removed book ID
through listRemovalCleanup and use retryRemovalCleanup; native startup also retries
the durable host queue. This closes lost file-cleanup intent for actual deletions
since migration 31, not RSS private data or failed binding persistence. An already absent owned binding is an
idempotent no-op. No new permissions or raw storage APIs are exposed. RSS private
subscription cleanup and its core-Agent approval workflow are separate concerns.

[环境] [Virtual-removal evidence](./evidence/virtual-book-removal-2026-09-09.json)
uses an isolated macOS Tauri Worker with command and Agent-tool paths. A SQLite
trigger rejects the synthetic book's deletion event: both paths report `db/error`,
preserving book and binding. A second trigger rejects binding KV writes: both
paths fail even though the book has already been deleted. Removing that fault
lets the Agent-tool retry complete and the command repeat become a no-op. Test
book/binding, triggers and contributions are gone. This is real native storage and
Worker evidence, not an autonomous model turn or full RSS unsubscribe test.
Concurrent creation/removal, crash recovery, packaged/Windows/Linux and the full
virtual-content lifecycle remain outstanding; LIB13 remains partial.

### Reader Controls Visibility

[代码] Reading 2.6 adds `queries.session().controls: { visible: boolean } | null`
and `commands.setControls(visible, guard?)`. `reading:read` can query and observe;
`reading:write` is required to change it. Agent `set_reader_controls` uses the
same controller with its turn AbortSignal and book/session guard. This is an
explicit show/hide command, not a toggle based on a potentially stale snapshot.
Null means no bound controls surface; commands require a ready reader.

The host's space/content-click/scroll/panel-intent paths use that same owner.
The last committed visibility is published through `observeSession`, incrementing
revision only when the value changes. Even a repeated-value command waits for
its own React DOM commit. The receipt is `{ status: "completed", sessionId,
controls: { visible } }`, not proof that a CSS transition or physical raster has
finished. Header and already-selected docked panels follow it; saved panel choices,
reading position/history, mode and playback are not modified.

New UI/actor intent, session replacement or surface disposal rejects outstanding
work with `reader/superseded`; invalid values use `reader/invalid-target`, a missing
or non-ready surface uses `reader/unavailable`, and no commit within ten seconds
uses `reader/timeout`. Agent abort and plugin instance termination cancel waiting.
Cancelled uncommitted intent is discarded and late acknowledgements ignored;
cancellation does not undo an already committed UI change. Plugins do not yet
have an independent per-call AbortSignal. Listening Desk 0.8 consumes the snapshot
and guarded command, closing its view only after success. It remains an on-demand
view rather than a live subscriber, and does not add a redundant model tool.

[验证] Controller, real React DOM, Agent tool and plugin view tests cover completion,
concurrency, stale guards, cancellation, timeouts, observer reentrancy, disposal and
failure propagation. Native evidence and remaining environment boundaries are
recorded in [reader controls evidence](./evidence/reader-controls-2026-09-09.json).

### Reader Panel Presentation

[代码] `services.ui` 1.1 adds the optional `reader` service. It is present only
with `reading:read` (also implied by `reading:write`): `snapshot()` returns
`ReaderPanelsSnapshot | null`, and `observe(handler)` immediately delivers the
current snapshot and subsequent revisions until disposed or the plugin stops.
Only `reading:write` adds `setPanel(panel, open, guard?)`. The four stable panel
IDs are `toc`, `annotations`, `appearance`, and `chat`; `open` is a boolean,
not a toggle. The service does not expose DOM, stores, annotations or chat content.
Agent `get_reader_panels` / `set_reader_panel` use the same service, restrict
book-scoped tools to the active book, and forward the turn's abort signal.

Snapshots contain `sessionId`, `bookId`, `revision`, `controlsVisible`, and
`panels[panel]: { open, visible }`. Null means no ready bound panel surface.
`open` is a selected panel state; a saved dock choice can remain open while
controls are hidden and `visible` is false. Snapshots describe committed React UI,
including optimistic KV values that can later roll back; they are NOT durable
save receipts. `setPanel` returns `{ status: "completed", panel, snapshot }` only
after that command's exact write succeeds (if any) and a fresh React commit
acknowledges the requested state. Same-value operations still require a fresh
commit but do not write unchanged preferences or increment semantic revision.
Opening reveals controls first. Closing does not reveal hidden controls.

TOC/chat use the book-scoped shared KV store; in narrow windows opening one
closes the other in one write. Annotations/appearance are transient and close
when chrome hides or the book changes. Native controls, mode-bar panel intents,
Ask AI presentation, Agent and plugin commands share the same owner. Initial
intents wait for a ready binding; successful presentation acknowledgements
survive a reader remount without consuming ChatPanel's independent attachment
request. Thus a completed old Ask AI request does not reopen chat on book reopen.
When appearance is moved from the inline header to More, the same fields render
in a viewport-bounded scrollable Dialog. This is an overflow placement, not a
new fully-hidden menu zone.

Guard validation, missing/retired surfaces and conflicting intents use
`reader/invalid-target`, `reader/unavailable`, and `reader/superseded`; ten seconds
without completion uses `reader/timeout`. A new panel intent supersedes the
previous one. Agent abort/plugin termination promptly cancel waiting and queued
undispatched work; already-dispatched persistence or already-shown chrome is not
undone. Save failures keep their database error code, roll back the optimistic
view, and use the existing localized write-failure notice. Observer copies and
errors are isolated. Receipts do not prove CSS animation, screen rasterization,
annotation/chat data loading or actual focus completion. Worker per-call abort
is still not exposed.

Listening Desk 0.9 requires UI 1.1 and composes four guarded panel actions with
reading mode, playback, history and controls. It closes its own view only on
success; a stale session guard leaves the view available for Refresh and retry.
[验证] Unit/React/actor tests and isolated macOS debug Tauri tests cover the paths
listed in [reader panel evidence](./evidence/reader-panels-2026-09-09.json), including
SQLite rejection, real Workers, real plugin UI, narrow/wide windows and fixed-layout
appearance. Packaged and Windows/Linux panel behavior remain unverified.

[代码] Private wheel-phase input now follows document lifetime: the app-owned
AppKit monitor evaluates one of three closed CustomEvent scripts in the main
WebView; mounted readers synchronously add/remove their own DOM listener. There
is no per-reader native registration or deferred unlisten. This changes neither
public capabilities nor Worker permissions. The earlier unregisterListener stack
and installed Tauri registration code support an asynchronous registration/retirement
race; the precise native scheduling interleaving was not instrumented.
[环境] The [wheel lifetime evidence](./evidence/wheel-phase-lifetime-2026-09-09.json)
records 20 actual FB2/PDF close/reopen cycles without the old rejection, 200 retired
listeners without callbacks, native eval delivery of touch/momentum/end and
synchronous cleanup. Rust tests preserve the phase classifier. The eval probe
uses the monitor's fixed scripts, not physical NSEvent input; the attempted
CGEvent probe had no posting permission and delivered no observed edges. Physical
trackpad delivery/timing, packaged and Windows/Linux input regression remain
unverified. This is not a claim that all Tauri subscriptions or input paths are safe.

### Mode Configuration Durability

[代码] Mode configuration writes the book's retained state and selected provider's
unit preference in one SQLite batch, after earlier KV writes settle. Completion
waits for the current generation's exact write receipts and initial position
persistence, not just index feedback or a late queue flush. A failed write returns
the original database code and restores the prior requested mode; optimistic
preference rollback is not treated as a new user intent. Deferred position writes
verify revision/provider/unit before dispatch and wait for configuration success.
Cancellation remains live during saving, and same-configuration waits have a
deadline. Compensation of every already-committed preference on cross-provider
cancellation are not closed by this configuration receipt.

[环境] Isolated macOS debug Tauri evidence covers actual Agent tools and Listening
Desk Worker callbacks with rejected book/preference writes, successful recovery,
retained positions on reopening, and delayed segmentation cancellation. Native
save failure renders localized copy. A held SQLite lock also blocked MCP
observation and ultimately returned db/locked; it is not evidence of responsive
UI while writes are delayed. Controlled IPC/React tests separately verify delayed
receipts and stale-write prevention. Packaged and other-platform validation remain
open; see [mode durability evidence](./evidence/reading-mode-durability-2026-09-09.json).

[代码] Unit stepping and returning now also await persistence of their exact
book/content-version/provider/unit/CFI target before acknowledging completion.
Position receipts are separate from configuration receipts: a failed movement
does not poison every later action in the same mode. An explicit next action can
retry an already-failed position, including returning without changing the CFI;
a new failure still reaches its original caller. Equivalent re-saves require the
newest receipt. A different target, content revision, mode retirement, caller
cancellation or newer navigation cannot acknowledge the old target. A cancelled
waiter releases the renderer queue without waiting for unresponsive storage.
Returning records jump history only after this barrier; ordinary unit steps do
not create jump history. `mode.status=ready` still describes indexed content,
not durable storage. Already-performed page movement and dispatched writes are
not rolled back. The automatic read-aloud loop awaits the same step receipt and
stops on a database error instead of playing the next unsaved unit.

[环境] [Position durability evidence](./evidence/reading-position-durability-2026-09-09.json)
uses the isolated macOS debug app, synthetic FB2, real Agent tool ports and
Listening Desk Worker actions. SQLite triggers reject unit/return writes; both
actors receive db/error and recover without reconfiguring. A two-second local
PCM diagnostic provider reaches playing, then advancing, then error/db/error
when the next unit cannot save; there is no second playing transition. The
visible native Next paragraph button also reports localized write failure and
recovers. The captured error surface contains multiple toasts from fault
testing; it is not a zero-noise UX or complete keyboard audit. Delayed-save,
supersession, retirement and history timing also have focused tests. No real
remote TTS, packaged, other-platform or all-format validation is claimed.

[代码] Legacy reading behavior preferences are now a side-effect-free read
overlay. Existing plugin values win; an explicit different mode owner neither
supplies values nor loses its source row. Configuration persists the book state,
merged plugin preferences and legacy-row deletion in one SQLite transaction;
settings patches also merge after prior writes settle and consume the source
atomically. Malformed legacy JSON contributes no values and is discarded only
by a successful commit. Source deletion failure rolls back all destination
writes and rejects the same Agent/plugin receipt with its database code.
The host-only batch IPC accepts null deletions; no raw KV authority is exposed
to plugins or the model. This does not make completed cross-provider preference
changes universally undoable.

[环境] [Migration evidence](./evidence/reading-mode-migration-2026-09-09.json)
records real Agent and Listening Desk Worker failures on a SQLite BEFORE DELETE
trigger in isolated macOS debug Tauri. The legacy row, original plugin values
and inactive book configuration survive. Removing the trigger permits recovery;
closing/reopening the book retains migrated values. Delayed receipts, malformed
data and foreign-owner retention also have focused tests; not every case was
repeated through native UI. Rust tests pass (128, one ignored), but packaged,
other-platform and complete keyboard validation remain open.

Every domain write uses the same canonical command path as the product and is
stamped with origin `plugin:<id>`. Plugins never mutate projections, feature
stores, or SQLite directly.

<a id="memory-read-domain"></a>
### Memory 1.0: Read Models and Trusted Graph Boundaries

[代码] `domains.memory` initially exposed read-only queries in 1.0. `memory:read`
grants `queries.search(input)` and `queries.bookGraph(bookId, query?)`, plus
`queries.inspect(id)` since 1.1. There are no event subscriptions; conditional
feedback commands were added in 1.1 below. Compatibility (`requires.domains.memory`) does
not itself grant access. Install consent describes personal/cross-book memory
and protected chapter graphs in all eight locales. `memory:write` was added in 1.1.
The shared contracts live in `packages/core/src/memory-query.ts` and
`book-memory.ts`; Agent ports re-export their existing type names.

[代码] Search accepts exactly `scopes`, `query`, `limit`. Scopes are a required
array of 1–16 `user`, `global`, or `book:<id>` strings; book IDs are nonblank and
at most 256 UTF-16 code units. Duplicates are removed. Optional query is trimmed
and at most 2000 code units. Optional limit is an integer 1–100, default 20.
Invalid input rejects with `memory/invalid-query`; unknown fields are rejected.
It returns cloned `MemoryRecord[]`, not conversations: active rows, the existing
text-match predicate, then pinned, importance and updatedAt descending. There is
no cursor, total, or exhaustion flag. Storage reads still enumerate memories
internally; the result limit is not an indexed storage or byte-budget guarantee.
Agent `search_memory` uses the same port/normalizer, with its existing scope
composition: book queries include that book plus user/global memory.

[代码/授权边界] `memory:read` currently grants all memory scopes. A query's
`scopes` is a filter, not a per-book or field authorization grant. MemoryRecord
content is not chapter-fenced. Reading a book graph is a separate policy-bearing
query; it does not make every memory record safe for spoiler-sensitive display.
No raw SQL, projection mutation, automatic promotion, forgetting, classification,
digest construction or task control is granted by these reads.

[代码] `bookGraph` validates a nonblank book ID of at most 256 code units and
accepts exactly an optional `names` array OR `chapterIndex`, never both. Names
contain 1–8 nonblank strings, each at most 256 code units, trimmed/deduplicated;
chapterIndex is a nonnegative safe integer in the extracted chapter sequence,
not a printed chapter number. `{}` requests an overview. Callers cannot supply
`confirmSpoiler` or a fence. The tagged `BookGraphResult` variants are:

| graph | Result |
| --- | --- |
| `unavailable` | Unknown trusted reading position; no chapter memory disclosed. |
| `empty` | No visible current-flavor digests; not a swallowed read error. |
| `miss` | Requested chapter has no visible current-flavor digest; absence and withheld existence use the same response. |
| `chapter` | chapterIndex, optional stored chapterHref, summary, entities and relations. |
| `overview` | chaptersDigested, chapterRange, entityCount, edgeCount, up to 200 entities with aliases/appearance count, truncated flag. |
| `profiles` | Up to 200 unique matched profiles with aliases/note, appearance chapter indices, up to 40 relations each with establishedAt, relationsTruncated, notFound and overall truncated. |

[代码] `packages/agent/src/memory/book-memory-policy.ts` supplies the shared
filter for graph queries and system-prompt chapter memory BEFORE merging
aliases, notes and relations. Missing legacy flavor is narrative; current book
flavor excludes mismatched digests after reclassification. Plugin graph policy
allows all chapters for expository or finished books. Unfinished narrative and
unclassified books use a strict-before boundary: for the live book, only its
ready href is authoritative; loading/unknown does not fall back to a later
saved location. Other books use saved progress href. Existing extracted chapter
identities resolve exact href first, then earliest base-href match; missing
position/identity withholds. Reads do not prepare text or generate digests.

[代码] Agent `query_book_graph` calls the same pure query but retains its trusted
turn policy: own unfinished narrative or unclassified book uses the turn's
completed-chapter boundary or existing
spoiler approval; global/cross-book retains the prior all-chapters policy. This
is shared query logic, not identical actor authorization. A book metadata read
failure now propagates instead of being swallowed and potentially bypassing the
fence; missing books reject `reader/book-not-found`. System-prompt chapter digest
assembly now uses the same flavor and boundary filter. This does not unify every
prose, grounding or output-guard policy. Result notes/fence are diagnostic prose;
Memory Desk renders localized state strings instead of exposing raw errors.

[代码/生命周期] Requests are normalized/copied before asynchronous work; plugin
activation lifetime is checked before and after reads. Retired owners reject
`plugin/cancelled`, including saved method closures. This discards late delivery,
not physical cancellation of already running SQLite reads. Database failures
propagate through stable error handling rather than returning empty lists.

[代码/组合] Memory Desk 0.1 used memory:read, library:read, reading:write;
0.2 upgrades to memory:write for conditional feedback. Both versions use
declarative views, shelf/reader header actions and an open command. It provides
personal/cross-book/book memory queries, 40-book pages (search filters the current
page), up to 100 memory results, graph/name/chapter queries, profile provenance
and source navigation. Overview/profile truncation is displayed; a source click
rechecks the current graph boundary, requires stored chapterHref, awaits reading
ready, then closes its own view. Missing provenance reports reader/target-not-found.
The plugin adds no Agent tool, network permission or LLM call. Source
roster now contains 14 plugins; Rust BUNDLED remains six, excluding Memory Desk.

[环境/验证] Isolated macOS debug Tauri tests use real SQLite, module Workers,
production Agent tools (not autonomous inference), compiled Memory Desk and a
synthetic three-chapter FB2. Evidence: [memory domain](./evidence/memory-domain-2026-09-10.json).
They cover denied/granted authority, explicit scopes, pre-merge spoiler protection,
unknown/live boundary, flavor reclassification, rejected caller spoiler claims,
localized SQLite read failure retaining the old view, retry and source navigation.
A repeated menu label was traced to two distinct plugin IDs (installed plugin
plus explicit fixture); cleanup removed only the fixture's contributions.

[设计/仍缺] Per-book/field grants, full pagination/exhaustion,
general feedback ratings, profile projections and formal context bundles remain open.
Stored chapterHref has no content hash and is NOT a versioned ReadingLocation;
rechecking visibility does not prove that an old digest belongs to replaced
source content. Extremely long stored entity names can exceed query input limits;
general large-result UX and chapter payload byte bounds are not closed by the
200/40 count limits. Packaged, Windows/Linux, all formats and autonomous-model
verification are not claimed by this unit.

<a id="digest-execution"></a>
### Digest Execution: Internal Reports, Not Public Tasks

[代码] `AgentRuntime.digestBook` and `digestBookCatchUp` now return an internal
`DigestReport`, not a count that conflates failure with completion. The report
contains `status: complete|partial|unavailable`, `eligible`, `attempted`,
`digested`, `remaining`, `emptyChapters`, and `{chapterIndex,errorCode}` failures.
`remaining` includes empty, failed and unattempted missing/obsolete rows;
`digested` counts only acknowledged saves in this pass, not the whole stored graph.
Unknown reader boundary and an empty TOC are unavailable with an explicit reason;
book/TOC/progress read errors reject instead of becoming zero backlog. Failed
automatic classification can still conservatively digest as narrative, but the
report remains partial with `classification-pending`, even when remaining is zero.

[代码] Full catch-up takes one finite pass through the sampled eligible range,
attempting each missing or flavor/version-obsolete chapter once. Empty/failing
early chapters do not prevent later chapters from running, and no chapter is
retried in the same run. A later run queries persisted rows again; failed rows
remain eligible while successful current rows are skipped. Capped idle ticks
still select the earliest missing entries; this is not a durable retry scheduler.
Concurrency is an integer 1–16 (default 1; desktop catch-up uses 6); maxChapters
is a nonnegative safe integer, default 2 for ticks. The full pass uses the finite
TOC range, not an unbounded retry loop. Per-chapter completion reports committed
count through the existing internal progress callback.

[代码] Non-stop inference (`length`, `error`, `aborted`, `toolUse`) and malformed
or missing summaries fail with `ai/provider`; genuine blank text is separately
reported, never persisted as a fake digest. A missing text result is
`library/content-unavailable`; other failures retain their stable code or
`ai/unknown`. Chapter failures are logged, reported and do not discard sibling
successes. Rebuilding an early chapter only passes earlier stored/completed
entities into its name-resolution prompt, never later names/aliases. The eval
resume path follows the same ordering restriction. This does not prove model
semantic correctness or eliminate the existing 20,000-character text truncation.

[代码/边界] The direct execution runner checks cancellation before/after reads,
inference and before saving, stops accepting new chapters, and waits for its
active logical workers before rejecting. An already dispatched save may commit;
there is no rollback claim. The outer `runMemoryBuild` now drains dispatched
protected write receipts before rejecting, but may abandon reads/inference.
It does not prove all underlying IO or remote model work has stopped. The report
alone does not provide public task lifecycle, scheduling or content-version/source
identity. Local scheduling and chapter/classification conditions are described below.

[环境] [Digest execution evidence](./evidence/digest-run-2026-09-10.json)
uses real SQLite ports in isolated macOS Tauri debug with scripted inference.
Chapter 0 returned length while chapter 1 still committed; a targeted owned-row
SQL trigger caused db/error with event count 8→8, and retry succeeded after
finally removing it. Paused inference cancelled before release did not save its
late result. Production Agent/Worker graph queries agreed, and compiled Memory
Desk 0.4 displayed rebuilt entities with future names excluded. One native
screenshot was inspected. The fixture does not run autonomous inference, the
full outer policy shutdown, remote sync or packaged/Windows/Linux variants.
That execution-report unit added no plugin API, permission or task UI. Public
task access is now provided separately by Memory 1.4 below.

<a id="digest-conditional"></a>
### Digest Commit Conditions

[代码] `BookMemoryPort.inspectDigest(bookId, chapterIndex, signal?)` returns null
for an absent book, otherwise `{bookId,chapterIndex,flavor,revision}`. The opaque
`bdg1:` revision is 64 lowercase hex digits over the book/chapter identity,
classification revision, raw chapter projection and last chapter event identity.
The runner captures it before text/inference and passes that exact revision to
`saveDigest(bookId,digest,expectedRevision,signal?)`; it never rebases a late
model result onto a fresh version. A changed flavor before inference fails early.

[代码] `book_digest_inspect` reads a SQLite snapshot. `book_digest_commit` takes
an IMMEDIATE transaction and rechecks book existence, revision and flavor before
the canonical event/projection/outbox write. Same-chapter competition and
classification ABA (change away and back) yield `memory/conflict`; unrelated
chapter writes do not invalidate the token. The supplied HLC must sort after
every already observed import/classification/merge/removal and same-chapter
digest, preventing an acknowledged local result from replaying before its
predecessor. Duplicate event IDs and malformed inputs are rejected. Successful
commit returns the new snapshot; the host port broadcasts only after success.

[代码] Native validation requires a nonblank book ID of at most 256 UTF-16 units,
nonnegative safe chapter index, nonblank summary, positive safe digestVersion,
narrative/expository flavor and optional string chapterHref. Only the documented
payload keys are accepted. Entity/relation arrays have at most 12 entries;
entities require nonblank name, optional string note and nonblank string aliases;
relations require nonblank from/kind/to and optional string note, with no extra
keys. Invalid targets/payloads/tokens return `memory/invalid-input`, a removed
book `reader/book-not-found`, conflicts `memory/conflict`, storage failure its
stable database code. No string-byte or alias-count budget is implied.

[代码/边界] The host clones input before asynchronous event minting, checks abort
before minting and again before native dispatch, and rejects early cancellation
with `memory/cancelled`. Already dispatched writes can commit and must still
broadcast their actual outcome. Failure rolls back event, projection and outbox.
A conflicting run does not increment digested; its sampled remaining is not a
fresh global backlog query and may include a chapter another run has completed.
These are local optimistic conditions, not distributed locks: legacy/general
remote event application is unchanged. No content hash, anchor read-set version
or full physical IO drain is claimed. The local queue below prevents overlapping
host passes; protected write receipts drain through the memory build policy.

[环境] [Conditional digest evidence](./evidence/digest-conditional-2026-09-10.json)
uses isolated macOS debug, a three-chapter FB2, scripted inference and six real
Workers. A Worker changed narrative to expository and back during inference:
chapter 0 conflicted while chapter 1 committed. A fresh pass repaired chapter 0;
a competing committed Winner then survived a late generator. Mutating caller
input after starting save did not change the persisted Winner. Pre-dispatch
cancel left broadcasts at 4. An owned SQL trigger caused db/error with both
event/outbox counts 15 to 15 and no broadcast; removing it allowed retry.
Agent/Worker graph results agreed, and compiled Memory Desk displayed Winner
and Rebuilt1 without future Hidden names. Native screenshot inspected; owned
records/Workers/trigger cleaned. This is not public-task or autonomous-model
E2E, nor packaged/Windows/Linux/remote-sync validation. Memory remains 1.3.

<a id="digest-scheduling"></a>
### Shared Local Digest Scheduling

[代码] `BookMemoryPort.runExclusive` delegates to one `BookDigestQueue` in the
desktop port module, not one queue per AgentRuntime or plugin context. Production
`digestBookTick`/`digestBookCatchUp` paths, including post-turn work, idle
maintenance and reading-open catch-up, enter this queue. Same-book passes execute
FIFO; different books have independent lanes. A waiting pass rereads the book,
classification, boundary, TOC and persisted digests when its turn starts, so a
prior successful chapter is not inferred again. Queued input copies its target,
budget and options before waiting; caller mutation cannot redirect it to another
book. Existing reading-open catch-up coalescing remains separate.

[代码] Active plus waiting requests across the queue are limited to 64. Overflow
returns `memory/task-limit` with retryable=true; all eight locales have matching
copy. Queued cancellation removes the job without calling its work and frees
capacity. Active cancellation does not prematurely release the lane: protected
commit functions themselves await the original write promise, not only the outer
`runMemoryBuild` finalizer. Book, stats, TOC, text and digest-list reads are guarded
so an abandoned read cannot indefinitely retain a lane or later start inference
or writes after cancellation. Failure releases the lane for the next pass.

[代码/边界] This is local serialization and fresh-state reuse, not distributed
ownership, a durable queue, a source-version lease or global model concurrency
control. Already dispatched writes may commit before cancellation settles;
abandoned read/model physical IO can still be running. Direct low-level
`digestMissingChapters` is not queued; production calls it only from the queued
upkeep path. Independent/remote writers still require native bdg1 conditions.
Cancellation preserves the caller's AbortSignal reason; a default DOMException
is not a newly defined public task error envelope. This unit adds no public task
IDs, progress observation, start/cancel/retry/rebuild API or task view.

[环境] [Digest queue evidence](./evidence/digest-queue-2026-09-10.json) uses isolated
macOS debug and three independent runtime-dependency instances over real SQLite.
The leader commits chapter 0 while its receipt delivery is held; a follower and
a cancelled queued request make no model calls. Cancelling the leader leaves the
follower waiting until the real port receipt is released. The follower then
generates only chapter 1; a fresh pass attempts zero chapters. Agent and Worker
graph queries agree; compiled Memory Desk shows Queued0/Queued1 and excludes future
names. Native screenshot inspected and owned records/Workers cleaned. Unit tests
also cover different-book progress, failures, FIFO, capacity/recovery, queued
cancellation, late reads and request mutation. This is scripted inference and
receipt gating, not stalled SQLite, autonomous models, public-task UI,
packaged/Windows/Linux or real remote-sync verification.

<a id="book-graph-tasks"></a>
### Memory 1.5: Public Graph Tasks and Chapter Budgets

[代码] `queries.listGraphTasks(bookId)` and `getGraphTask(bookId,taskId)` read only
this actor's handles. `commands.startGraphTask(bookId,"catch-up"|"rebuild",options?)`,
`cancelGraphTask(bookId,taskId)` and `retryGraphTask(bookId,taskId,options?)` require
memory:write; start and retry additionally require service:llm at the Worker
context boundary. Arbitrary digest payloads and caller-supplied chapter/fence
overrides are not accepted. User/system domain callers are trusted host actors.
Memory reads remain available without inference permission.

[代码] `options` is exactly `{maxChapters:number}` when supplied: a safe integer
from 1 to 1000; no null/array/coercion/unknown keys. Start defaults to 20 attempts;
retry inherits the prior limit unless explicitly overridden. Validation and
copying occur before enqueue/approval. Attempts include empty and failed chapters;
the executor admits at most this number even with two concurrent workers.
Unattempted targets remain pending and take priority over previously empty/failed
targets on retry, preventing a small limit from repeatedly starving later chapters.
A limited pass reports `reason:"chapter-limit"` and remains partial; classification
pending takes precedence if both conditions apply. This is not a model-call,
input-byte, token or spending cap: classification can add a model call, and chapter
length/provider charges vary. Automatic upkeep and explicit internal full catch-up
keep their existing budgets; each public task has its own approved limit.

[代码] `BookGraphTaskSnapshot` contains taskId, bookId, mode, maxChapters, optional retryOf,
revision, createdAt/updatedAt, status, optional DigestReport and errorCode. Status
is queued/running/cancelling/cancelled/completed/partial/unavailable/failed.
Accepted means queued, not generated. The report counts eligible/attempted/saved
and remaining chapters in this pass; failures and empty chapters remain distinct.
Queries return clones. `events.observe` adds `{kind:"graphTasks",bookId}` and
`{kind:"graphTask",bookId,taskId}` using the existing bounded, coalescing one-second
query observer, not every transition or an event log. Errors clear live UI state.

[代码] Each plugin activation has its own owner; Agent handles share one host
owner across model configuration changes. Neither lists automatic upkeep jobs
or another actor's tasks. Per owner: at most 16 active requests (including
cancelling) and 64 retained handles, evicting oldest terminal tasks. The shared
book queue additionally caps 64 active/waiting passes across owners. Overflow is
memory/task-limit (retryable); unknown/foreign/evicted handles memory/task-not-found
(not retryable), invalid book/mode memory/invalid-input, forbidden generation
memory/forbidden, invalid retry state memory/conflict. Unconfigured inference
fails the accepted task with ai/not-configured; automatic-build and local-only
policies still apply. Provider/DB errors retain stable codes, not raw messages.

[代码] The host resolves the live reading boundary after queue entry, and rechecks
before chapter reads/inference and saves. Unknown position is unavailable, not
permission to process a whole narrative book. Expository/finished books permit
all prepared chapters. Automatic classification sampling is limited to already
completed chapters (at most eight); it cannot use a later chapter merely to
classify the book. Generation uses the configured fast model, concurrency two,
one finite chapter-limited pass, without deleting old digests before successful conditional
replacement. Retry creates a new handle and retains unfinished targets: a failed
rebuild's OLD valid row must not count as a successful replacement. Retry of a
running/cancelling/completed task is rejected; no silent retry loop is created.

[代码] Cancel first moves to cancelling and aborts the execution signal. It becomes
cancelled only after the protected executor settles, including dispatched write
receipts; committed chapters and remote charges are not undone. Caller/activation
abort cancels requests, future calls from the retired owner fail, observations
stop, and no retired plugin receives new callbacks. Cancellation of a queued
request does not cancel another owner's active task. Underlying read/model IO
may outlive a cancelled logical task. Task handles and plans are not persisted.

[代码] Agent `manage_book_graph` supports list/get/start/rebuild/cancel/retry in
both scopes. Book threads are limited to their book; global requests require an
explicit discovered book ID, but generation still follows the live host boundary.
List defaults to 10 and caps at 20 with offset/nextOffset. Every start/rebuild/retry
requests generate-book-graph approval with book identity and operation; decline
does not enqueue. Input is copied before approval. Reads/cancel need no model-cost
approval. This is not a tool to recursively invoke the chat Agent.

[代码/环境] Memory Desk 0.5 combines graph queries, library navigation, task
observation, explicit cost confirmation and live task list/detail/cancel/retry.
[Public task evidence](./evidence/book-graph-tasks-2026-09-10.json) records six
Workers, real SQLite and native OpenAI-compatible SSE to a scripted loopback
provider. Read-only/no-LLM permissions were denied; another actor's list was empty.
Failed rebuild retained Ada while the other chapter updated; retry attempted only
the failed chapter. Agent queued behind plugin work, queued/active cancellation
terminated without late saves, and Worker retirement aborted two held requests.
Compiled Memory Desk was clicked through confirmation validation, partial/error
display and successful retry; both native screenshots were inspected. Agent
approval was scripted through the real port, not clicked in the approval component
or generated by an autonomous model. Agent/Worker graph reads agreed and excluded
future names. Native write-failure/receipt-delay evidence belongs to prior units.

[边界] MEM10 is now partial on both sides, not unconnected and not fully complete:
there is no user-defined token/money budget, durable recovery, cross-device task
ownership, source-content hash/lease, or full semantic inference proof. Prepared
chapter content is required; this API does not import/extract missing book text.
Public summaries remain sampled results, not a fresh global backlog. Packaged,
Windows/Linux, real remote sync and full long-duration behavior were not tested.
The first fixture setup hit a reload and lost its in-memory restore state; only
owned test book/config were cleaned, and restoration of pre-first-setup isolated
configuration was not proven. Successful second setup cleaned its captured state.
No formal application data was used. This is an environment limitation, not proof
of a shipped task restart/recovery contract.

[代码/环境] Memory Desk 0.6 requires memory 1.5 and composes a numeric chapter-limit
field, renewed confirmation, inherited/overridden retry limits, limit and unavailable
reason display, one-based empty/failed chapter numbers and host-localized errors.
Agent `manage_book_graph` accepts maxChapters only for start/rebuild/retry. The
permission request carries the resolved limit through the production chat mapper;
all eight localized descriptions include the task subject and limit. Previously
the graph permission description omitted subject interpolation, hiding the book and
operation. Graph interactions now follow the existing suppressed tool-row policy.
[Budget evidence](./evidence/book-graph-budget-2026-09-10.json) verifies real Worker
limits and inherited retry, actual Agent approval component decline/approve/retry,
and compiled Memory Desk limit 1 followed by retry limit 2. Each pair generated
only chapter 0 then chapter 1; future chapter 2 remained untouched. Three native
screenshots were inspected. The new retry ordering for empty/failed predecessors
was added after this native run and is unit-tested, not claimed as native proof.
Agent UI was mounted in a fixture using the real interaction port and chat mapper,
not a full chat or autonomous decision. The test configuration now has encrypted
write-ahead backup outside sync/hydration prefixes: an explicit WebView reload,
refusal to overwrite the old backup, recovery and backup deletion were verified.
This protects future test configuration recovery, not old lost settings, durable
production tasks, or crash recovery of every fixture-owned book/memory record.

<a id="book-classification"></a>
### Memory 1.3: Book Classification

[代码] `memory.queries.classification(bookId)` requires `memory:read` or
`memory:write` and returns `{bookId,narrativity,revision}`. Narrativity is
`narrative`, `expository` or null (not yet classified). A missing book returns
null; invalid stored classification fails `db/error`, never an unclassified
success. IDs are nonblank and at most 256 UTF-16 units. Revision is opaque
`bcl1:` plus 64 lowercase hex characters, computed from classification and
relevant event identity in one read transaction. It rejects equal-value ABA,
ignores unrelated reading/metadata writes and is device-local, not a content
version or distributed compare-and-swap.

[代码] `memory.commands.classify({bookId,narrativity,expectedRevision})` requires
`memory:write`, which authorizes this operation on accessible books. Narrativity
must be narrative/expository; no reset-to-null, automatic-fill flag, arbitrary
event or extra fields. The host copies input, checks lifecycle before and after
event minting, then native `book_classification_commit` rechecks existence and
version in an IMMEDIATE transaction. Event log, projection and outbox commit
together. Result is `{snapshot,changed}` after commit; `memory/conflict` requires
fresh inspection and a new decision, not blind retry. Cancellation before
dispatch rejects `memory/cancelled`; after dispatch it does not undo the commit.
Source origin is the actual plugin/Agent/user, not an input field.

[代码] `events.observe({kind:"classification",bookId},handler)` adds a fourth
query to the Memory 1.2 observation protocol. Ready result is
`{kind:"classification",snapshot}`; null means the book disappeared. The same
64-observer budget, serialized reads/callbacks, initial async snapshot,
1000-ms-after-completion polling, error/recovery, owner cleanup and late-result
discard apply. The outer event revision orders deliveries; only the snapshot's
bcl1 revision can authorize a conditional classification change. No per-book
grant is added by the query filter or observation.

[代码] Product Agent `classify_book` supports inspect/classify in both scopes;
book threads can only address their current book, global threads supply an
existing ID. Every change freezes the requested value/version, reads current
state, and requests `classify-book` approval with the book title/ID and exact
before/after classification. Localized consent explains that expository books
have no chapter spoiler fence. Decline/cancel does not write; a concurrent
change while approval is pending still conflicts. A tool must not reclassify
merely to evade spoiler policy. Manual correction remains available with
automatic memory building disabled. This is not a general inference task.

[代码] Memory Desk 0.4 (requires memory ^1.3.0) composes the existing book picker
with classification detail/observation and a conditional form. Changing the
classification requires a checkbox acknowledging its spoiler-boundary effect.
The form captures the viewed revision and selected classification; background
updates do not rebase it. A failed write leaves the draft and checkbox intact.
Back to detail observes fresh state; a new form uses the new version. Read errors
remove stale details/actions and recover automatically. This checkbox is plugin
UX, not a host-issued approval ticket: a granted plugin may call classify
directly, while Agent changes always use its approval tool.

[代码] The internal `classifyBookIfUnclassified` path remains separate. Native
storage only fills null and returns the winning persisted flavor to the digest
pipeline, without a fake event/broadcast when another writer already classified
the book. New automatic events carry onlyIfUnclassified, honored by the current
projector during both replay orders. Legacy unmarked events remain unconditional;
older clients do not enforce the guard. Existing mismatched digests rebuild
lazily, not on classify completion. No cancellation of in-flight digests, erasure
of previous answers, versioned provenance or public graph-rebuild task is added.

[环境] [Public classification evidence](./evidence/book-classification-public-2026-09-10.json)
covers six real Workers in isolated macOS Tauri debug, absent/read/write grants,
strict input/stale versions, live changes, errors/recovery and unsubscribe.
The production Agent tool and interaction port used the real ChatInteractionPrompt
mounted in a controlled native fixture root: actual buttons declined, approved,
and approved after a concurrent write that correctly conflicted. This is component/
tool integration, not a full AgentThread/chat transcript or autonomous model run.
Compiled Memory Desk 0.4 changed the persisted classification, retained a
conflicting draft, cleared a corrupt SQLite read and recovered after finally
restoring the owned row. Four screenshots were inspected; SQLite confirmed
actor origins, owned-book removal and three forgotten synthetic memories.
Packaged, all locales/formats, real relay/second-device and Windows/Linux remain
unverified. Foundational native transaction/replay evidence is
[recorded separately](./evidence/book-classification-storage-2026-09-10.json).

<a id="memory-feedback"></a>
### Memory 1.1: Conditional User Feedback

[代码] `queries.inspect(id)` returns `{memory, revision}` for an active memory,
or null for missing/superseded/forgotten rows. ID is nonblank, at most 256 UTF-16
code units. Revision is opaque `mem1:` plus 64 lowercase hex characters, derived
from the serialized row and newest locally appended memory event identity under
one SQLite read transaction. It changes even for equal-timestamp ABA writes.
It is device-local, not a cross-device clock or an approval token.

[代码] `commands.mutate(input)` requires `memory:write`, which implies read.
Every input contains `memoryId` and `expectedRevision` from inspect, plus exactly
one operation: `{op:"correct",content}`, `{op:"setPinned",pinned}`, or `{op:"forget"}`.
Content is trimmed, nonblank and at most 16000 UTF-16 units; pinned is a strict
boolean. Extra fields, invalid revisions, custom reason, scope, kind, weight,
evidence-count and raw event input are rejected. This is not arbitrary memory
creation or projection access. Plugin writes during activation are denied.

[代码] Host normalizes/copies input before asynchronous work and mints canonical
events with the actual actor origin. Rust `memory_commit` independently accepts
only content-only `memory.revised`, pin/unpin-only `memory.feedback`, or
`memory.forgotten` with reason=user and matching aggregate identity. A SQLite
IMMEDIATE transaction checks the active row/revision, rejects a reused event ID,
appends/applies through `commit_events_in_transaction` (including sync outbox),
reads the new revision and commits. Result is `{memoryId,revision}`, with null
revision after forgetting. Stable errors: `memory/invalid-input`, `memory/not-found`,
`memory/conflict`, `memory/unavailable`, `memory/cancelled`, `memory/forbidden`;
storage failures retain their database code. Events are broadcast only after IPC
success. Signals are checked before dispatch; after dispatch, cancellation does
not undo a durable mutation or justify reporting that nothing changed.

[代码] Agent `manage_memory` is sequential in both scopes. Inspect does not ask;
correct, setPinned and forget require the caller's revision and ALWAYS ask through
the existing permission interaction with action `manage-memory`, displaying ID,
scope, old content and requested operation/value. The validated change stays
frozen through approval, and native CAS rechecks after the answer. Decline returns
changed=false. Book threads can manage user/global/own-book records, not another
book's memory. Global threads can inspect a discovered memory ID across books.
Existing-memory management is independent of the memory-building switch; it does
not run an LLM or promote a new fact. Permission titles/descriptions, plugin
consent and stable errors are localized in eight languages.

[代码] Memory Desk 0.2 reads inspect on entry, shows full content/ID/scope and
adds correction, pin/unpin and forget. Each action captures the displayed revision;
SQL failure or conflict preserves the form draft, not an auto-rebased overwrite.
The user returns, refreshes and decides again. Forget requires a confirmation
checkbox; correction uses a textarea. Pin/unpin is reversible, correction can be
edited again. Forget only excludes this record from active retrieval, retaining
event history and not removing prior prompts or external copies. There is no
public restore operation. Old 0.1 installs need approval of the added write grant;
the native fixture does not prove the full upgrade-consent flow.

[环境] [Native evidence](./evidence/memory-feedback-2026-09-10.json): real Worker
read/write separation, stale revision rejection, Agent approval/decline and
concurrent-write rejection, compiled plugin SQL fault/retry, retained stale draft,
explicit forgetting and canonical event origins. Agent answers were scripted via
the production tool's interaction port, not native chat clicks or autonomous
inference. Rust tests cover ABA, conditional event/outbox/projection rollback and
payload restrictions. Packaged, Windows/Linux and cross-device approval/CAS are
not verified by these tests.

[代码] Existing-record consolidation and extraction reinforcement now use the same
row/event revisions. See the internal maintenance boundary below. No
per-book plugin grant, full pagination, event-history erasure
or arbitrary feedback scoring was added. Legacy `correct`/`reject` feedback
signals have no projection effect; new correction deliberately emits revised,
not that ineffective feedback event. Core now includes the already-implemented
native `unpin` signal rather than using a type cast to hide the contract drift.

<a id="chapter-memory-integrity"></a>

### Chapter Memory Projection Integrity

[代码] Agent and plugin graph reads share `createBookMemoryPort` and its
`decodeChapterDigestRows` boundary. Native responses are `unknown` until validated:
the top level and both JSON columns must be arrays; each row must match the
requested book, have a unique nonnegative safe-integer chapter index, string
summary/provenance, and positive safe-integer digest version. Entities require
nonempty string names; aliases must be arrays of nonempty strings; optional notes
must be strings. Relations require nonempty string from/kind/to and string notes
when present. Unknown extra fields are not copied into the public result.

[代码] Legacy missing/null flavor and provenance remain valid. An unknown explicit
flavor is a failed read, not a narrative fallback. Malformed JSON, invalid nested
fields or one invalid row rejects the entire read with `db/error`; no silent
empty graph or partially filtered result. Diagnostic messages name only the
invalid field, not persisted content. This validates structure, not factual
accuracy, relationship endpoints across chapters, total payload budgets, or the
association between an old digest and a replaced source file.

[代码] Explicit Agent/Worker queries propagate the failure. Memory Desk 0.3's
existing live view clears old content/actions and recovers automatically after a
valid read. Optional prompt digest loading logs the failure and omits the whole
digest section so chat can continue; this is not a claim that the graph is empty.
A degraded digest load does not settle the chapter-session cache; the next user
turn retries without requiring a new session or explicit reset.

[环境] [Native evidence](./evidence/chapter-memory-integrity-2026-09-10.json)
covers real SQLite malformed JSON, alias type and unknown-flavor faults on an
owned synthetic FB2, actual Agent tool and Worker calls, compiled Memory Desk
error clearing and automatic recovery. Three native screenshots were inspected.
AgentThread failure logging/recovery uses an in-memory port and faux provider,
not native model inference. No packaged/cross-platform or automatic repair claim.

<a id="memory-prompt-policy"></a>

### Shared Chapter Memory Policy and Prompt Refresh

[代码] `chapterMemoryPolicy` defaults an unclassified book to narrative. Narrative
and unclassified unfinished books expose only chapters strictly before the
trusted current chapter; unknown/invalid positions withhold. Expository or
finished books allow all chapters, still filtered to the current flavor. Missing
legacy digest flavor is narrative; reclassified mismatches never enter alias
merging, graph profiles or the prompt roster. Plugin href resolution retains its
live-ready / saved-position policy; Agent uses the current turn's normalized
cursor. These are different sources of authority, not caller-selected fences.

[代码] AgentTurnState separates the completed-chapter memory boundary from the
inclusive prose fence. Graph tools recheck book metadata when called, so an old
all-visible sample cannot override a later restrictive classification. Trusted
spoiler approval and global/cross-book graph policy remain unchanged. This does
not grant arbitrary plugin spoilers or apply chapter filtering to user memories.

[代码] AgentThread keys its prompt cache by classification, reading status,
current chapter index and chapter-memory policy. Changes, including lost cursor
or finished-to-reading contraction, refresh the prompt before the next user turn's
model request. The sampled book and cursor also supply the actual prompt, not a
second inconsistent metadata read. Selection chapter remains a conversation-session
signal but cannot widen reading authority. A policy-only refresh preserves
accumulated messages; normal cross-chapter session reset retains its old semantics.
An unchanged successful same-chapter snapshot stays cached; failed digest reads
log, omit the digest section, and leave the cache unsettled for the next turn.

[环境] [Native evidence](./evidence/memory-prompt-policy-2026-09-10.json) uses a
real AgentThread with production SQLite ports and scripted inference, plus real
Worker queries and compiled Memory Desk. Narrative/expository/narrative changes
in the same chapter produce corresponding prompt samples with 1/3/5 messages,
not a reset transcript; the plugin switches Ada/Concept without refresh. Future
selection, lost cursor and an unclassified row were also exercised. Two native
screenshots were inspected. Unit tests additionally cover invalid/index-only
positions, status contraction, failure retry and tool-time restrictive metadata.

[边界] Refresh is next-turn, not cancellation of an already sent request, erasure
of prior answers/tool results, or provider-side deletion. Stable-policy digest
edits alone do not invalidate the successful cache. This unit covers chapter
memory, not all unclassified-book prose retrieval/grounding policies. Source
versions, budgets/pagination, fine-grained grants, public graph maintenance and
packaged/cross-platform verification remain open.

<a id="memory-observation"></a>
### Memory 1.2: Query Observation

[代码] `events.observe(query, handler)` returns a PluginDisposable under
memory:read (also implied by write). Exactly three query variants are accepted:
`{kind:"search",query:MemoryQuery}`, `{kind:"inspect",memoryId}`, and
`{kind:"bookGraph",bookId,query?:BookGraphQuery}`. Normalization copies inputs,
rejects extra authority/fields, and enforces the existing query/ID limits before
allocating a subscription. There is no event-log access or new write permission.

[代码] Each subscription immediately starts an asynchronous authorized read,
then schedules another read 1000 ms after the previous read and callback finish.
Reads and callbacks are serial per subscription. Identical results/error codes
are suppressed; recovery to the same earlier result is delivered. Handler failure
is logged and the latest result is retried on a later poll rather than falsely
acknowledged. The host-wide limit is 64; disposal/owner abort releases its slot
and timer and drops late read results, but does not undo dispatched SQLite work.
New calls on a retired owner reject. Slow consumers extend the polling interval.

[代码] Events have per-subscription increasing `revision` and either
`{status:"ready",result}` or `{status:"error",errorCode}`. Ready result is
`{kind:"search",memories}`, `{kind:"inspect",snapshot}` or
`{kind:"bookGraph",graph}`. Inspect null means missing/inactive, not a read error.
Revision is a delivery sequence, not mem1 CAS, durable identity or global clock.
Read failures are logged with raw details and delivered as stable database codes
or `memory/observation-failed`; `memory/observer-limit` is terminal until a slot
is released. New error copy exists in all eight locales.

[代码] Every graph poll reruns the existing flavor/fence filtering. Position,
classification and native remote-apply changes become visible through queries,
without relying on a complete event bus. Search scopes remain filters, not
per-book grants; memory records themselves retain their existing scope policy.
This is eventual observation of bounded query results, not every write: changes
between polls may coalesce, scope-excluded changes produce no payload, and
unchanged results need not emit even if an underlying event was appended. Native
query reads and graph metadata assembly are not a new cross-table snapshot/CAS.

[代码] Memory Desk 0.3 composes observe with UI publishView and live views for
memory lists, records, graph overviews, named profiles and chapters. Initial or
later read failures show an inline coded error and remove old content/actions;
recovery resumes without clicking refresh. Successful list updates retain local
search. Entering an edit/forget form ends that frame's observer; its draft and
expectedRevision stay frozen. New detail actions capture new revisions. Closing,
back navigation and plugin retirement release subscriptions through view ownership.
The book picker remains a paged query snapshot, not a library observer. Existing
source navigation still rechecks the graph before opening its chapter.

[环境] [Native evidence](./evidence/memory-observation-2026-09-10.json) covers
real Worker read/write/absent grants, invalid spoiler authority, local/Worker/
native remote-apply changes, Agent search of the same persisted result, compiled
list search retention, SQL read failure/automatic recovery, frozen draft conflict,
forget-to-null/empty, graph-boundary contraction/restoration and unsubscribe.
The synthetic FB2 uses scripted digests; remote apply uses locally minted test
events. No autonomous model, network relay/E2E, packaged or cross-platform claim.
Backpressure, callback failure, budget release and late-read abort use unit tests.
Polling is not instantaneous revocation of previously delivered content, durable
subscription, maintenance task control, pagination, full payload budgeting or
proof of all graph/Agent prompt consumers sharing identical spoiler policy.

<a id="memory-maintenance"></a>
### Conditional Background Maintenance

[代码] The internal MemoryPort now exposes `snapshotMemories(filter?)` in addition
to plain queries. Rust `memories_snapshot` reads active records and row/event
revisions in one read transaction. Consolidation captures these before model
judgment; extraction and legacy-transcript adoption capture the selected records
before asking for reinforcement. The model receives memory text, not authority to
invent revision tokens. Duplicate reinforced IDs are deduplicated.

[代码] `reinforceMemory(snapshot, signal?)` uses that exact snapshot, not a fresh
post-model record. `applyMemoryChanges(changes, snapshots, signal?)` freezes the
read set and simulates ordered decay, forgetting, supersession/winner credit and
promotion before minting events. The native `memory_maintenance_commit` checks
every supplied revision under an IMMEDIATE transaction, then validates/applies
the events and commits the entire plan, including outbox entries. A missing or
changed record rejects memory/conflict with no partial batch. The API rejects
unconditioned targets, duplicate conditions/event IDs, non-agent origin, raw
content changes, invalid ranking/evidence changes, invalid promotion and pinned
automatic forgetting/supersession. A supersession must be followed by its winner
credit in the same batch. Existing event IDs cannot be silently accepted as a new
plan. It returns the surviving supplied read set with post-commit revisions,
captured inside that same transaction. It never acknowledges unread insertions
or later edits through a second store read. Public feedback permissions and
mutation methods are unchanged from memory 1.1; observation is added in 1.2.

[代码] The judgment normalizer skips malformed array entries and overlapping
merge/contradiction endpoints; a retained winner cannot subsequently become a
loser in the same plan. Pinned records are not automatically replaced. Stale
plans reject rather than automatically rebasing, and failed consolidation cannot
report proposed counts as committed counts or mark the dirty revision clean.
Memory-building cancellation is passed to the host and rechecked after event
minting, before dispatch; cancellation is not undo after dispatch.

[代码] Each eligible `consolidateIfNeeded()` now reads authoritative active
snapshots, comparing a canonical ID/revision checkpoint and the existing
30-day decay rule against the host clock. This replaces the runtime-own-write
counter: user/plugin/native remote-apply edits, insertions, removal and time-only
eligibility can trigger a new pass. Unchanged, not-due data skips model work, not
the store read. Successful passes settle only the transaction receipt (or the
original read set for a no-write pass); changes during/after that pass remain
eligible on the next check. Model exceptions, non-object/unparseable output and
non-`stop` completion reasons leave judgment unsettled. Deterministic decay may
still commit after a failed judgment; the next check retries judgment without
repeating that freshly committed decay. Runtime in-flight deduplication remains.

[代码/环境] Scheduling is still the existing five-minute idle loop, initial
queue and return-to-visible queue, subject to an available Agent runtime and
enabled memory building. Hidden/closed apps do not run this loop. This is bounded
poll cadence, not an immediate change subscription, durable job or an execution
deadline; slow model/background work can delay a pass. Restarting creates a fresh
checkpoint. No extra observer/timer or plugin maintenance authority was added.

[环境] [Native evidence](./evidence/memory-maintenance-2026-09-10.json) verifies a
real Worker correction during scripted judgment, stale merge/reinforcement
rejection, second-event SQL failure with whole-batch rollback, successful retry,
and subsequent editing through compiled Memory Desk. Rust tests independently
cover event/outbox rollback and payload/read-set restrictions. Model answers were
scripted, not autonomous inference; packaged/Windows/Linux and distributed races
are unverified. The Pin/Correct icon fallback discovered there is now fixed by
registering the existing `push-pin`/`pencil-simple` names in the host icon catalog.

[环境] [Idle evidence](./evidence/memory-idle-2026-09-10.json) uses a real
AgentRuntime with production SQLite ports restricted to one owned fixture row,
actual Worker writes, native `applyRemote`, and compiled Memory Desk pin/correct
actions. Each change reruns evaluation and then settles. With an injected clock,
30 days minus 1 ms skips, the exact boundary decays; an owned SQL rejection leaves
importance and event count unchanged, then retries successfully at the same
clock. These direct idle calls do not test five-minute wall-clock scheduling or
autonomous inference (one row needs no model). Native remote apply uses locally
minted fixture events, not relay/E2E or a second device. Rust proves receipt
exclusion of unread insertions/late edits; Agent tests cover failed/incomplete
judgment retry, time-only expiry, external changes and post-receipt races.

[设计/仍缺] Tokens are local. Newly inserted rows outside the captured read set
do not invalidate it; no serializable judgment over the future whole collection
is claimed. New-fact promotion/deduplication, repeated extraction of forgotten
facts, complete pipeline quiescence, whole-store/model budget control, public
maintenance task control, per-book authorization and true cross-device CAS remain open.
Unread insertions do not cancel a running judgment, but now remain dirty for the
next eligible poll rather than being absorbed into its settled checkpoint.

## 6. Settings Is a Domain

Settings is not a helper beside the domain system. It is a first-class domain
because ReadAware owns settings state, catalog metadata, validation, target
resolution, persistence, and change effects.

Appearance is a Settings section, not a domain and not a service.

Current stable sections include General, Shelf, Appearance, Reading, Annotations, Menus and
Shortcuts, AI, Sync, and Plugins. Sections organize discovery and UI; they do
not create separate APIs.

Each setting definition owns:

- stable path and section;
- value kind and default;
- validation and option source;
- supported targets;
- actor read/write policy;
- sensitivity and persistence policy;
- canonical read, update, and post-commit behavior.

Settings operations are:

- discover permitted definitions;
- read resolved values;
- capture a settled, path-filtered snapshot of values and override metadata;
- update permitted paths at supported targets;
- subscribe to committed changes.

Since `domains.settings` 1.1, one validated update commits all affected KV
records in a single local SQLite transaction. The Agent and Worker await that
transaction; a failure rejects and publishes no `settings.changed` event.
Commands share an ordered queue and read after their predecessor settles, so a
later patch cannot accidentally persist an earlier rejected change. The read
also waits for already accepted native UI/remote KV writes and runs without a
gap before enqueueing its transaction. An optimistic matching UI value is not
treated as a durable no-op. Returned
snapshots, like reads, are filtered to the actor's permitted paths.

Native preference atoms and Worker mirrors can show optimistic values while
the command runs and follow rollback if it fails. Declared plugin settings
invalidate from that mirror, after all KV observers have run. Their form
submission also returns the actual write promise. This is local persistence,
not a guarantee that every setting has an effect consumer, that remote roaming
has committed, or that secrets and operating-system changes are transactional.
Settings 1.6 adds settled snapshot observation for those sources below. The older
`events.subscribe` remains domain-command-only, not an all-source event log;
CFG10 retains the documented provenance and UI-effect limits.

### Settled settings observation

[代码] Settings **1.6** adds `queries.observe(query, handler)` and a required
numeric `revision` on `SettingsSnapshot`. Existing Agent `get_settings` and
`update_settings` use the same revision; the model re-reads on demand rather than
owning a background observer. Plugin observation uses the same target/section
query and exact read grants as snapshot. Discover-only grants reveal no values.
Snapshot, discover and field read wait for domain, KV and credential writes to
settle. Credential waiting protects `credentialConfigured`, not access to keys.

Results are `{ status: "ready", snapshot, source, origin }` or
`{ status: "error", revision, code, source, origin }`, never raw failure text.
Source is `initial`, `local`, `remote`, `restore`, `catalog`, or `mixed`.
Domain and plugin-storage writes retain their declared actor. Unattributed
legacy native writes, unknown remote actors, catalog changes and mixed actors
use null. Coalesced source is invalidation provenance, not an edit audit trail.
Only changed authorized projections are delivered, including options,
availability and conflict metadata. Hidden/no-op commits can advance the clock
without delivering another projection. Revision is process-local, not HLC,
replay, exactly-once delivery, a frozen pagination session or a write CAS guard.

[代码] One durable KV transaction notification replaces reliance on optimistic
mirrors. All settings persistence keys and the plugin `.settings` family
invalidate the projection. Native UI, domain/Agent/plugin writes, roaming
overlays, backup merges and prefix replacements use that boundary. Multi-key
commands notify once; failed persistence delivers no successful change. Backup
KV merge now uses one native batch and keeps its previous roaming publication
policy; prefix replacement still does not republish edits. Declared plugins,
theme/font registries, header/selection actions, reader mode and shortcut
environment changes invalidate catalog metadata separately.

Host credentials now use ordered optimistic writes: an older failure cannot
overwrite a newer pending value. Successful AI credential writes invalidate only
safe metadata, not values; sync/plugin secret changes do not enter the catalog.
Settings reads verify both queues are settled in the same JS turn. The stores
are not one transaction and encrypted-at-rest storage is unchanged.

[代码] Host credential roaming now listens to exact successful local secret
writes, not AIConfigPanel call sites or the optimistic snapshot. Failed writes
and remote-tagged overlays never publish credential events. The host-only
publication listener receives the committed value for immediate sealing; public
settings observers still receive only safe configuration metadata. Sealing uses
the durable master key, never a queued optimistic replacement. Catch-up waits
for pending credential writes and rollbacks before sampling. Relay/transport
connection setup awaits required credential writes before account adoption and
profile activation. Sealed remote overlays await the encrypted local write and
announce only successful movement; failed writes roll back and retry on a later
refresh. No new Agent tool or plugin secret permission is introduced.

[环境] [Credential roaming evidence](./evidence/credential-roaming-2026-09-10.json)
covers isolated macOS debug encrypted writes, rejected insert/replacement/delete,
sealed event payloads, remote overlay failure/recovery and non-echo. Delayed
publication, failed catch-up, pending master-key replacement and rejected
connection setup also have isolated IPC regression tests. This is not a network
relay or cross-device convergence test. Credential storage and event append
remain separate transactions: event append is best-effort, not a durable outbox
or crash-replay guarantee. Atomic account switching, legacy key adoption,
ordinary KV overlay completion, stale projection races, all UI drafts and
packaged/Windows/Linux verification remain open.

[代码] There are at most 64 observers globally (`settings/observer-limit`). Each
serializes reads/callbacks and coalesces slow delivery. Invalidation during a
read triggers another read rather than attaching an outdated cause. Handler
errors log without poisoning future delivery. Read errors carry stable codes,
with `settings/unavailable` as the unknown-error fallback; recovery is on the
next invalidation or subscription, not a timer. Disposal suppresses later
delivery but cannot undo an already-running callback. Plugin subscriptions stage
until promotion and retire with the owner. Captured reads check cancellation
before and after waiting; queued plugin writes check it before dispatch. Already
dispatched persistence is not rolled back by retirement.

Workspace Profiles **0.3** combines this observer with UI 1.2 live publication.
Current workspace shows seven preset values, updates without refresh, retains
the last sample beside a localized read error, clears errors on recovery, and
unsubscribes on leaving. Profile CRUD and explicit shortcut editing are unchanged.

[环境] [Desktop evidence](./evidence/settings-observation-2026-09-10.json)
records no/read/write Workers, actual Appearance-page click, production Agent
book/global tools, remote-overlay/prefix-restore sources, theme registration and
removal, compiled plugin at 1200×800 and 800×650, SQLite rejection without a false
observation, and disposal/cleanup. Synthetic IPC tests cover credential overlap,
failure and dual-queue barriers; real credentials were not changed. Autonomous
models, full backup/network sync, all settings drafts/effects, packaged builds,
Windows/Linux and high load remain unverified. Legacy command events and unknown
legacy actor provenance remain explicit limits.

Since `domains.settings` 1.2, nine previously host-only preferences are shared
by the Agent tools and granted plugins:

| Path | Values | Targets and effects |
| --- | --- | --- |
| `reading.textAlign` | `book`, `start`, `justify` | global/book/all-books; actual reflowed text alignment |
| `reading.fixedLayoutColor` | `theme`, `original` | global/book/all-books; actual fixed-layout page rendering, not reflow typography |
| `general.whatsNewDialog` | boolean | global; whether to show the existing post-update release-note notice |
| `appearance.contentTypography.followReader` | boolean | global; follows global reading typography, not the open book's override |
| `appearance.contentTypography.fontFamily` | catalog/plugin font, `system:<family>`, or null | global; detached content face; null restores the app sans font |
| `appearance.contentTypography.fontSize` | `x-small`, `small`, `medium`, `large`, `x-large` | global; detached content size, separate from the reader size ladder |
| `appearance.contentTypography.lineSpacing` | `compact`, `comfortable`, `relaxed` | global; detached content line spacing |
| `annotations.defaultColor` | `yellow`, `green`, `blue`, `pink` | global; next native highlight/underline reads the current value; existing marks remain unchanged |
| `general.updateChannel` | `stable`, `beta` | global, device-local; changes the next update check, without checking, installing, or restarting |

Independent content font/size/spacing values apply only while `followReader`
is false. Typography uses its existing JSON record; default color and update
channel retain their existing raw-string KV encodings. All participate in
the shared atomic local batch. An already mounted About panel observes
channel changes and rollback. macOS debug Tauri evidence covers both actors,
real FB2 alignment/highlights, PDF canvas colors, typography, permission
rejection, and injected SQLite failure; post-update relaunch behavior,
other desktop platforms, and packaged validation of these nine paths remain
unverified. See [delivery evidence](./host-capability-delivery.md).

### Shelf preferences and workspace profiles

[代码] `domains.settings` 1.3 adds three global, device-local paths to the
same catalog used by product Agent tools and granted plugins:

| Path | Values |
| --- | --- |
| `shelf.layout` | `grid`, `list` |
| `shelf.group` | `none`, `status`, `author`, `format` |
| `shelf.sort` | `recent`, `added`, `title`, `author`, `progress` |

They update the existing shelf preference record, including atomic batches with
other settings. The shelf atom follows external KV writes and failed-write
rollback even when unmounted. These preferences do not navigate, change the
active collection/filter/selection, or mutate books. Per-book targets reject.

[代码] Plugins can now call `queries.snapshot(query?)`. Unlike separately timed
reads, it waits for previously queued settings commands and local KV writes to
settle before one synchronous snapshot. Returned values and override paths are
filtered by read/write grants; discovery-only grants reveal no values. This is
not a revision token or an atomic read-modify-write transaction; another actor
can change settings after capture. Existing `read`/`discover` can still show
optimistic state, while this snapshot is intended for coherent saved presets.

[代码] Workspace Profiles 0.1 composes this API with private document storage,
shelf header/command views and the `workspace_profiles` Agent tool in global
and book scopes. It saves exactly the three shelf paths plus `appearance.theme`,
`appearance.motion`, `reading.fontSize` and `reading.lineSpacing`. Names trim to
1-80 characters; each save creates a UUID document in `profiles`. Apply
validates the version, exact path set and global targets, then submits one
atomic settings update. Current catalog validation rejects stale theme options
without partial changes. Global reading changes preserve existing book overrides;
the tool returns override metadata. Delete removes the preset, not host settings.
It neither changes AI privacy nor accesses credentials or plugin lifecycle.

### Keyboard shortcut settings

[代码] Settings 1.4 adds the `shortcuts` section: all 16 built-in editable
bindings, currently registered plugin commands and retained overrides of
unregistered plugin commands. Agent `get_settings` and
`update_settings` use the same catalog, validation, atomic KV transaction and
live binding atom as granted plugins. Existing keyboard handlers consume that
atom. This is not a second command-execution API.

- Built-ins use `shortcuts.<id>`. Plugin commands use
  `shortcuts.plugin.<encoded-contribution-key>`: percent-encode the entire key,
  including dots and `!~*'()`, as one opaque segment. For example,
  `shortcuts.plugin.workspace-profiles%3Aopen`. Discover the exact path rather
  than interpreting a command label or decoding arbitrary input. Manifest
  path validation accepts uppercase percent escapes; grants still match exact
  paths or explicitly requested path prefixes.
- `kind: "key-chord"`, global/device-local only. Values are optional `mod`,
  `alt`, `shift` tokens followed by one `KeyboardEvent.key`; `mod` means
  Command on macOS, Control elsewhere. Space is `" "`, not `"Space"`.
  Named keys are ArrowLeft/Right/Up/Down, Enter, Tab, Backspace, Delete, Insert,
  Home, End, PageUp/Down and F1-F24. A single printable Unicode code point is
  accepted and lowercased. Duplicate/unknown modifiers, modifier-only input,
  control characters and Escape reject with `settings/invalid-shortcut`.
- Writing null removes the override and restores the registered default. It
  is not an explicit unbind; commands without a default then read null.
  Snapshot metadata `shortcut` contains `defaultBinding`, `overridden`,
  `available` and conflicting setting paths. Availability means registered
  providers, not current focus/command enablement or OS key availability.
- Snapshot/read values respect path grants; `writable` reflects the actor's
  write grant, and conflict references are filtered to readable paths.
  Discovery omits values and live shortcut metadata. A hidden conflicting
  binding still rejects a write without exposing that binding's path.
  Since settings 1.5, `shortcut.conflicted` reports suspension independently
  of the grant-filtered `conflicts` array; an empty array is not proof of no
  conflict. `available` still describes the registered provider, not routing.
- Validate the final batch, not intermediate edits: swapping two bindings in
  one update works. Conflicts reject with `settings/shortcut-conflict`, no
  persistence or change event. Unrelated legacy conflicts do not block other
  edits. The existing conservative global conflict space excludes unavailable
  mode/lookup providers. Failed native writes roll back bindings and other
  settings in the same batch; queued snapshots see the settled state.

[代码] The native Shortcuts editor now submits per-path commands through the
same settings domain with origin `user`, rather than replacing an atom/KV map
captured by React. Recording, single reset and reset-all await the shared
transaction; controls stay disabled during submission. Conflicts and native
write failures produce localized destructive toasts, not silent success.
`shortcutBindingsAtom` is read-only; the old direct binding setter was removed.
Reset-all captures the settled shortcut catalog and submits one batch of null
changes for its overrides, including dormant plugin overrides. This does not
introduce compare-and-swap or a global revision lock.
The persisted map parser ignores unknown built-in IDs and the empty `plugin:`
ID, while retaining nonempty dormant plugin IDs; otherwise reset-all could
leave invisible, unaddressable entries behind.

[代码] An unregistered plugin's override remains in the catalog with an opaque
contribution-key label, `available: false`, `overridden: true`, and
`defaultBinding: null` because no registered default is known. It is inert,
does not reserve a chord against active commands, and still obeys exact path
grants. Agent/plugins may read, modify or remove that existing override. The
native editor groups it under Unavailable commands and offers reset. After
null removes it, the row disappears until the command registers again; unknown
paths cannot create arbitrary dormant overrides. Registration reuses the
existing override without duplicate rows. Registration can introduce a conflict;
settings 1.5 suspends every matching binding until rebind or retirement removes
the ambiguity, without mutating persisted overrides or choosing a winner.

[代码] Global, plugin and Foliate reader key handlers now use one synchronous
live catalog and dispatch decision, including forwarded iframe events. The
settings command environment and native editor use that same provider state.
Conflicts consume the event so vertical-page and primary-navigation fallbacks
cannot run instead. Unique bindings owned by another surface also skip the
reader's vertical fallback. A consumed event cannot trigger a second handler.
Inactive reader-mode/selection actions still permit the existing vertical
fallback; a registered mode is not necessarily the currently active mode.
Commands are fetched at event time, so registration/disposal does not wait for
a React effect. Typing targets keep bare-letter input; global shortcuts remain
global but do not gain priority over a conflict. Composition and Escape do not
dispatch configurable shortcuts. This retains the conservative settings
conflict space, not a new focus-sensitive priority system. The native editor
shows a localized persistent InlineError on each conflicted row and removes it
when the shared catalog no longer reports that conflict.

[代码] Workspace Profiles 0.2 adds a native-rendered shortcut form using only
its own exact command path grant. Default/custom mode, modifier toggles and a
key field submit one settings command. Its seven-field saved presets remain
unchanged. Plugin action failures now carry only the stable error code to the
host toast bridge; recognized codes render localized copy, unknown failures
retain the generic fallback. Raw error details remain in logs. A failed submit
preserves the form and cannot emit a success toast or close it.

[环境] [Keyboard evidence](./evidence/keyboard-shortcuts-2026-09-09.json)
covers actual Agent tools, a real Worker batch swap, native keyboard dispatch,
the installed Workspace Profiles form, conflict toast, null reset and cleanup
in isolated macOS debug Tauri. It does not prove model inference, packaged
builds, Windows/Linux, all key layouts or every reader/native-menu route.
Additional [native editor evidence](./evidence/shortcut-editor-2026-09-09.json)
covers native rebind/reset/reset-all, actual keyboard dispatch, an Agent reset
refreshing the mounted editor, Worker edits of a retired command, and persisted
cleanup. An isolated React/native-IPC test holds and rejects writes to verify
busy state, rollback, error presentation and actor ordering. These are not
real SQLite-lock or full keyboard-layout tests.

[环境] [Dispatch evidence](./evidence/shortcut-dispatch-2026-09-09.json) covers
real Worker reactivation conflicting with global search, native conflict
notices and rebind recovery, reading page conflicts on the window and actual
Foliate document, retirement recovery, and plugin opening without a second
page turn. Iframe key events were constructed in the actual book document;
window chords used the native keyboard tool. Integration tests exercise both
listener mount orders, immediate registration/disposal, two conflicting
plugins and grant-redacted conflict metadata. No model inference, all-layout,
all-format/selection/mode routes, packaged or cross-platform claim is made.
UI04 remains partial: full revision/origin observation and the remaining
keyboard-route/platform validation are open, not exemptions.

[环境] The [desktop evidence](./evidence/workspace-profiles-2026-09-09.json)
covers real product tools, the built plugin Worker, save/validation/apply/delete
UI, shelf grouping and ordering, the header entry, and cleanup in isolated
macOS debug Tauri. Focused tests cover queued actors, permission filtering,
native write rollback and snapshots waiting for failed UI writes. No model
inference, installation approval, packaged build, cross-platform or restart
durability claim is made. A development rebuild caused a transient module-load
boot failure before the same app remounted; the resulting diagnostics notice
is visible in screenshots. UI02 was subsequently connected by UI 1.3 below;
CFG10 retains its remaining gaps.

### Workspace navigation and selection

[代码] UI service **1.3** adds `services.ui.workspace`, owned by the shared
`WorkspaceService` and the app shell adapter. `library:read` or `library:write`
exposes `snapshot(query?)` and `observe(query, handler)`; only `library:write`
exposes `navigate(target, expectedRevision?)`. These reuse existing domain grants
without creating a second permission catalog. Reading grants alone do not reveal
the workspace. Leaving an active reader additionally requires `reading:write`.
Opening settings or command search does not close the reader. Activation may
declare observations but cannot navigate; retirement aborts pending operations
and disposes subscriptions. Captured methods cannot regain authority after stop.

[代码] Targets are a closed union:

| Target | Accepted fields and effect |
| --- | --- |
| `shelf` | `collectionId?: string|null` (omitted means root), `selection?: { active: boolean, bookIds: string[] }`; omitted selection clears it |
| `agent`, `stats` | Open the native Context or statistics surface |
| `settings` | `section?`, default `general`; nine built-ins: general, appearance, reading, ai, plugins, menus, shortcuts, dataSync, about; `plugin:<id>` only for an enabled plugin declaring settings |
| `search` | `query?`, default empty, at most 4096 UTF-16 code units; opens the existing command palette, not full-book search or a new filtered shelf |

Shelf selection accepts at most 1000 IDs, each nonblank and at most 256 UTF-16
code units, cloned and deduplicated. Inactive selection must be empty. All selected
books must exist in the target collection; root means uncollected books, not all
books. An empty library cannot enter selection mode. No hidden selection is
created. Selecting books does not authorize their deletion or execute a command.
The host reconciles selection after collection changes, book moves and removal,
including while the shelf is hidden. Layout/grouping/sort remain `settings`
operations, not duplicate workspace state or a second persistence layer.

[代码] Snapshots contain a monotonic process-local `revision`, the committed
`surface` (`shelf`, `agent`, `stats`, `plugin`, `reader`), current collection,
settings open/section, command-search open/query, and selection active/total/page.
They contain no reader book ID, text, credentials, DOM, settings values or raw
router/atom handles. `snapshot({ selectionAfter?, limit? })` uses ascending
code-unit ID order, defaults to 100 and permits 1–1000. `nextCursor` is the last
returned ID when another page exists; total describes the full selection, not
the page. This is not a frozen pagination session: compare revisions and restart
when state changes. Unbound reads reject `ui/unavailable`.

Observation delivers an initial snapshot (or null when unbound), then committed
state changes. Each callback is serialized; slow consumers receive the latest
coalesced state rather than an unbounded queue. The service permits 64 observers
globally, reports callback errors to the log, and delivers null on shell retirement.
Dispose prevents later delivery but cannot undo a callback already running.

[代码] `navigate` validates targets and an optional nonnegative safe-integer
revision. Newer navigation supersedes prior work. Native atom changes during
async validation or reader close also win. Database failures remain failures,
not missing-target or empty-state success. Library targets wait for the existing
library UI replica to contain imported/updated targets before applying selection;
the wait is abortable and does not invent another book store. Reader exit uses
the existing reading controller and animated handoff. Neither cancellation nor
failure rolls back an already-dispatched reader close or ephemeral UI change.

The 10-second operation deadline includes validation and rendering. A receipt is
`{ status: "completed", snapshot }` only after the intended destination's layout
effect inside its Suspense/error boundary and a matching fresh shell commit.
Dispatch alone, a spinner, or an incorrect settings section cannot acknowledge
completion. This proves component commit, not animation completion, focus,
background data loading, durable reading-time settlement or sync completion.
Seven localized service errors are `ui/invalid-target`, `ui/target-not-found`,
`ui/superseded`, `ui/unavailable`, `ui/timeout`, `ui/reading-permission`, and
`ui/observer-limit`. Storage errors and caller abort reasons retain their identity.

[代码] Product Agent book/global scopes register `get_workspace` and
`navigate_app` through the same service. Query pages are capped at 25; model
output uses an explicit 256-character search preview with `queryTruncated`.
JSON-expanded identifiers can shorten a selection page to stay below the 16000
character tool budget; total and a usable continuation cursor are preserved.

Library Desk **0.3** composes collection queries, workspace observation, native
navigation and a search form with the existing live-view protocol. Cross-collection
checkbox selection first becomes explicit collection groups; choosing one group
shows only that group's IDs on the shelf. A successful navigation closes the
plugin dialog; failure leaves it open. The workspace header observes the native
selection count, while the collection list is a snapshot refreshed by reopening.
Its 0.3 manifest requires UI ^1.3.0 and reading:write as well as library:write;
normal installation/update consent remains required for the expanded grant.

[环境] [Desktop evidence](./evidence/workspace-navigation-2026-09-09.json)
covers isolated macOS debug Tauri: real permission-gated Workers, both production
Agent scopes, a two-book native selection/page, hidden/missing-target rejection,
native command-result navigation, reader-close authorization, settings over a
real FB2 reader, moved-book reconciliation, and compiled Library Desk group/search
UI. Unit tests additionally hold/reject DB reads, defer UI-replica publication,
cancel/supersede owners, withhold destination commit and stress observer delivery.
This does not prove autonomous model decisions, full installation consent,
packaged/Windows/Linux, all dialogs/focus, remote-race convergence or 1000-book
native performance. UI03 is separately and partially connected below;
UI01/UI02 are connected for the explicit semantics above.

### Host command discovery and execution

[代码] UI **1.4** introduced `services.ui.commands.list/execute`; **1.5** adds
typed book/collection targets and shares their execution with the native palette. Both Agent scopes
register `list_host_commands` / `execute_host_command` over the same
`createHostCommands` service. This is a finite semantic catalog, not reflection
over menu labels, arbitrary host callbacks or another plugin's command IDs.

The 16 parameterless IDs are `go-shelf`, `go-context`, `go-stats`, `open-settings`,
`select`, `layout-grid`, `layout-list`, `sort-recent`, `sort-added`, `sort-title`,
`sort-author`, `sort-progress`, `group-none`, `group-status`, `group-author`,
`group-format`. Two resource commands, `open-book` and `open-collection`, bring
the total to 18. Each descriptor has a localized host title, `enabled`, optional
`checked`, `settingsPath`, `unavailableReason` (`permission`, `workspace`,
`reader-control`), and an object parameter schema with no extra properties.
Basic commands have empty schemas; resource commands require exactly `bookId`
or `collectionId`, respectively (nonblank string, at most 256 UTF-16 characters).
The snapshot has `version: 1` and `workspaceRevision: number | null`.

- Library read/write exposes discovery; only library write exposes execution.
  Shelf settings additionally require their own `settingsAccess.write` paths;
  hidden setting values never become `checked`. Reader exit additionally needs
  reading write, as does opening a book even from the shelf. A pending opening
  with no session yet also requires reading control to cancel before navigation;
  settings can open over the reader without it.
- Request shape is `{ id, args?, expectedWorkspaceRevision? }`; resource commands
  require the matching one-key args object, basic commands omit args. Unknown IDs, extra keys,
  fractional/negative/unsafe revisions reject `ui/invalid-target`. The accepted
  request including resource ID is copied before waiting. A stale revision rejects `ui/superseded`.
- Discovery reports coarse authorization and attached-workspace conditions, not
  a reservation or a proof of target validity. Execution rechecks them and the
  workspace revision. Empty-library selection, removed collections/books, and
  subsequent reader handoff still validate through the workspace/reading controllers.
  `open-book` rejects `reader/book-not-found` for a missing book;
  `open-collection` rejects `ui/target-not-found` for a missing collection.
- Layout/sort/group write one actual shelf setting, then navigate to the shelf,
  preserving the current collection and selection. More than 1000 selected IDs
  rejects `ui/unavailable` before writing; no silent truncation. `select` opens
  root selection with no selected IDs; `go-shelf` opens root and clears selection.
  `open-settings` preserves the current section or uses general. `open-collection`
  clears selection and opens the requested shelf collection. `open-book` awaits
  the shared reading controller's ready receipt; it does not dismiss unrelated
  settings/search overlays or another plugin's dialog.
- Settings and workspace are not one atomic transaction. Before a committed
  setting, errors reject without a success receipt. After it, navigation failure
  returns `{ commandId, status: "partial", completed: ["settings"], errorCode }`.
  A successful result has `status: "completed"` and `completed: ["workspace"]`
  or `["settings", "workspace"]`; `open-book` returns `["reading"]`.
  Raw exception text is not put in receipts.
  Cancellation after a write does not roll it back; Agent formatting preserves
  a host partial receipt rather than replacing it with a late abort exception.
- Completion inherits the underlying settings persistence and destination
  component-commit contracts; open-book additionally waits actual reading ready.
  None promises animation, focus, time settlement or sync. Plugin activation/retirement rejects new execution; its lifetime signal
  stops waiting/queued effects where the underlying operation supports it.

[代码] The native command palette maps its 16 basic actions and dynamic book/
collection rows to these same typed requests. Display IDs (`book-...`,
`collection-...`) never become public command IDs. Its user executor captures
the workspace revision before lazy runtime loading, awaits completion, disables
repeat activation while busy and renders localized failures. Escape/backdrop
dismissal and unmount abort the request; navigation closing its own palette does
not cancel its destination commit. Frame ownership prevents an old completion
from closing a reopened palette. Import and plugin-contributed rows retain their
existing dispatch callbacks; their dispatch is not claimed to be task completion.
Other native header/menu/shortcut entrypoints are not all migrated by this change.
Agent execution is sequential, discovery and execution share the same service.

[代码] Reading cancellation/timeout now invalidates the opening intent as well
as rejecting its waiter, so a delayed shell lookup cannot call begin after it
has been retired. Closing an opening before it creates a session also revokes
that token; authorized workspace navigation accounts for this pending state.
This does not roll back renderer/history effects that already occurred.

[代码] UI **1.6** adds `services.ui.commands.observe(handler)`, with the same
library read/write grant as list. Each subscription first reads the authorized
command projection, then re-reads on committed workspace changes (including
reader entry/exit), settled shelf-setting observations and host language changes.
Settings observations include local, remote-tagged, restore and catalog changes;
unchanged authorized command output is deduplicated, so hidden setting changes
do not leak through additional deliveries. This is not a reservation, resource
enumeration, focus observer or target-specific enabled check.

- Payload is `{ revision, status: "ready", snapshot }` or
  `{ revision, status: "error", code }`. Revision starts at 1 and orders only
  delivered values within that subscription; it is not a global revision,
  `workspaceRevision`, settings CAS or a revision shared with Agent queries.
- At most 64 command subscriptions per runtime; underlying settings/workspace
  observation limits can reject registration earlier. Registration failures
  release acquired sources. Initial subscribe/read races discard superseded
  reads; slow callbacks serialize and coalesce invalidations to the latest state.
- Read errors are logged and delivered as stable codes; the next invalidation
  may recover. Handler errors are logged without killing the subscription.
  Workspace detachment yields a ready catalog with workspace-unavailable
  commands, not an empty command list. Disposal is idempotent, aborts the read
  owner, releases sources and suppresses late delivery. Worker track/promote/
  retirement rules apply; no observer executes commands on the user's behalf.
- Agent list/execute still query this same service on demand. There is no new
  perpetual model loop or claim that every host operation has dynamic availability.

[代码] Library Desk **0.6** extends Workspace > Host commands: searchable host titles
and IDs, current checked values, unavailable reasons, explicit refresh, guarded
execution, close only on full completion. Partial completion stays open with a
saved-setting statement and host-localized error. Refresh never automatically
repeats the write. The command page now subscribes only while visible, composing
observe + publishView with a detail surface containing a stable nested list.
Checked/available states update without clearing search. Observation failure
keeps the last rows, adds a host-localized inline error and removes stale actions;
recovery restores actions. Resource pickers remain query-time snapshots, and
execution revalidates stale state. Book/collection commands compose library
queries with searchable resource pickers, then execute the selected real ID with
the revision of the clicked command snapshot, not a later live update. Its manifest requires UI ^1.6, views ^1.2 and
read/write grants for exactly `shelf.layout`, `shelf.sort`, `shelf.group`.

[环境] [Native evidence](./evidence/host-commands-2026-09-10.json) covers isolated
macOS debug: real no/read/write/full Workers, both production Agent scopes,
preserved two-book selection, revision rejection, real FB2 reader authorization,
SQLite write failure with no navigation, recovery, and compiled plugin search
and list-layout execution. Deferred writes, partial receipts, retirement and
all 16 basic operation mappings are additionally unit-tested.
[Current routing evidence](./evidence/command-routing-2026-09-10.json) adds real
Worker resource schemas/grants/missing targets, book/global Agent resource calls,
native palette dynamic results and compiled Library Desk 0.5 resource pickers.
A targeted SQLite failure kept the native palette open with no successful setting
event; recovery produced one settings.changed with origin=user and closed it.
That failure exposed duplicate storage/command toasts. The subsequent
[observation and error-ownership evidence](./evidence/command-observation-2026-09-10.json)
verifies their repair: settings-domain commits explicitly assign failure presentation
to their caller. KV rollback, logging, `local-write-failed` and Promise rejection
remain; the event carries owner=caller and the global toast bridge does not render
it twice. This host-only per-operation flag is not plugin-controlled or a global
suppression window. Legacy void writes and other batches retain store-owned
presentation, including while caller-owned writes fail concurrently. Native
commands and compiled plugin actions each showed one localized SQL-failure
notice; a legacy write still showed its one global notice. Failure/retry retained
the actual grid/list value and destination behavior. This is not a declaration
that all other async store facades already have caller-owned presentation.
The same native evidence verifies Worker initial state, hidden-field filtering,
unsubscribe, real reader availability, host-language titles and compiled live
checked values from local and remote-tagged writes with search preserved.
Read-error recovery, slow handlers, 64-observer limits and exact stale-read races
are unit-tested, not all native-injected failures. Delayed opening cancellation
was reproduced in a failing unit test before the controller fix; exact delayed
lookup, timeout/frame concurrency and partial-result windows are not all native
E2E evidence. Deterministic tool calls are not autonomous model decisions.
Import task results, cross-plugin command invocation, remaining native entrypoints,
complete target-level availability and focus, packaged and Windows/Linux remain
open. **UI03 remains partial on both ends.**

### Host inference privacy policy

[代码] `ai.preferences.localOnly` is enforced at the shared model-call boundary,
not only in settings UI. The cached product Agent runtime checks live preferences
for every smart/fast completion and stream, including background model calls.
Worker `services.llm.ask` (plain, structured, streaming) and native connection
tests use the same policy. Enabling it rejects new calls with non-retryable
`ai/local-only`, aborts in-flight transport signals, and suppresses late answers
and delayed retries belonging to cancelled calls. Re-enabling permits only new
calls. There is no product-local inference backend; a Custom loopback endpoint
does not bypass the policy. This does not add a model-call tool to the Agent.

[代码] Preference changes are observed optimistically. If persisting the change
fails, settings roll back and no committed settings event is emitted; new calls
may resume after rollback, but cancelled calls are not resurrected. Policy and
caller listeners are released at the call's terminal result. The public stable
code is localized in all eight locales; provider-flattened stream errors retain
the `[ai/local-only]` marker for classification, not for user-facing raw prose.

[环境] Isolated macOS debug Tauri tested both actors, ordinary/structured/stream
calls, native connection UI, concurrent cancellation, late-output suppression,
new calls after re-enable, and SQLite failure/rollback. The diagnostic fixture
now backs up its configuration in the encrypted secret store before mutation
and can recover after a WebView reload. The initial closure-only fixture lost
its first backup during development reload; that attempt is not counted as a
successful restoration. See [exact evidence](./evidence/inference-local-only-2026-09-09.json).

[代码/边界] This is not a global network firewall: arbitrary granted plugin
HTTP, TTS, sync, and other network services are not governed by this policy.
`sendHighlightedText` and `sendSurroundingContext` now constrain the Agent's
automatic reading inputs as described below, not arbitrary plugin content.
SET26 therefore remains partial. Complete
privacy-boundary coverage, packaged CSP and other desktop platforms are not
verified by this change.

### Host Reading Context Policy

[代码] The existing Agent settings tools and exactly authorized plugin settings
paths now control the product runtime's live reading-context policy:

| Setting | Effect on new Agent requests |
| --- | --- |
| `ai.preferences.sendHighlightedText = false` | Omit automatic selection attachments, including hydrated history and `get_recent_turns` / `search_conversation` results. Exclude attachments from search matching, not just returned records. |
| `ai.preferences.sendSurroundingContext = false` | Skip deterministic grounding and omit the viewport. |
| Either setting is false | Omit the whole viewport, including `get_reading_session.visibleText`, because it can overlap a withheld selection. Preserve location metadata and the original spoiler fence. |

[代码] Locally stored attachments and manually authored question text remain
unchanged. A permission change between turns discards the cached model context
and rehydrates permitted records. Each turn captures its grants: enabling more
text affects only a new turn, including history/session tool calls. Tightening
revokes the active grant permanently, rejects with retryable
`ai/context-changed`, aborts model transport, suppresses late output, and releases
the busy state even while an asynchronous preparation read is pending. Background
memory jobs capture the originating turn's grants when queued; tightening cancels
queued/in-flight work, including plugin memory candidates. Legacy history adoption
filters attachments before extraction/summary. Re-enable or preference rollback
never resurrects a cancelled operation. Already-sent bytes and dispatched writes
cannot be retroactively revoked. Shared policy waits check revocation before and
after resolution so an already-fulfilled Promise cannot win against an aborted grant.

[代码] `services.llm.ask` / `AgentRuntime.ask` accept `readingContext` since
LLM capability 1.1.0. It contains optional `selection` and `surrounding` strings,
plus `required?: Array<"selection" | "surrounding">`. The host validates the
shape and assembles only permitted fields into the model input; surrounding is
withheld when either text permission is false. Required fields must be nonempty
and present: invalid declarations fail with `ai/invalid-reading-context`; a
required but withheld field fails before inference with `ai/context-withheld`.
Both are nonretryable without correcting input/settings. Plain, schema/retry,
and streaming paths share the captured policy; tightening aborts transport,
rejects with `ai/context-changed`, suppresses late output/retries and releases
listeners. No caller-supplied cancellation/task budget is added by this contract.

[代码] Dictionary 1.3 requires LLM ^1.1.0 and settings ^1.2.0 with exact read
access to both text preferences. Selection callbacks mark the term's source;
term and permitted passage use the structured fields, not prompt interpolation.
Every supplied fragment is required, so a settings race cannot cache an answer
for a different input. Withheld context uses a distinct context-free cache key.
Exact local cache hits do not invoke inference and remain readable with sharing
off. Saved words retain source; legacy words without it are conservatively
treated as selections when regenerating. Explicitly provided/typed terms remain
ordinary prompts. Local selection processing is not itself external disclosure.

[环境] The [structured-reading evidence](./evidence/structured-reading-context-2026-09-09.json)
covers 24 isolated macOS debug calls (two actors, three modes, four flag
combinations), actual built Dictionary Worker cold/cache/denial paths, a
malformed-response retry, and three concurrent held calls cancelled by a
settings Worker. Provider records prove filtering and transport cancellation;
SQLite plugin document counts stay unchanged on denial/cancellation. Re-enable
permits a new lookup only. Selection input is fixture-supplied, not a UI gesture;
packaged and other platforms are not verified here.

[代码/边界] This is an input-origin policy, not arbitrary string redaction or a
global book-data prohibition. Existing assistant prose, memories, summaries and
chapter digests can contain previously quoted material. Independent book/annotation
retrieval, plugin context providers, selection/lookup callbacks, plugin-authored
LLM prompts and granted HTTP/TTS retain their own boundaries; the two settings do
not yet govern all those routes. Both SET24 and SET25 remain partial, but are no
longer classified as having no execution consumer. The model-facing withheld
selection note is explanatory only; runtime filtering is the enforcement.

[环境] Isolated macOS debug Tauri verified four flag combinations through Agent
and actual settings Worker writes, actual FB2 viewport sampling, outbound loopback
requests, retained SQLite attachments with filtered history/session tools,
in-flight transport cancellation and a new request after re-enable. The attachment
was supplied by the fixture, not a selection UI gesture. Grounding inclusion is
covered by runtime tests; this one-screen native sample produced no additional
grounding block. Packaged, Windows/Linux, full privacy-settings UI and complete
plugin data-flow coverage remain unverified. See
[structured evidence](./evidence/reading-context-policy-2026-09-09.json).

### Host Memory Build Policy

[代码] `ai.preferences.buildMemory` is a live host policy shared by Agent settings
and exactly authorized plugin settings. Disabled means no new host-derived
memory: explicit `remember`, onboarding seeds, extraction/reinforcement, plugin
candidate promotion, legacy transcript adoption, rolling insights, consolidation
(including decay), chapter digests and automatic narrativity classification.
The runtime subscribes when work is queued, not when it finally starts. Disabling
revokes queued and in-flight operations with `ai/memory-disabled`, aborts their
model transport and suppresses late results; re-enabling permits only new work.
Summary writes and clears await SQLite durability and propagate failures.

<a id="memory-commit-drain"></a>
[代码] `runMemoryBuild` separates revocable `operation.guard` reads/inference
from `operation.commit` mutations. `operation.protect` uses commit tracking for
saveMemory, reinforceMemory, applyMemoryChanges, putInsights, putProfileSummary,
saveDigest and classifyBookIfUnclassified; onboarding and explicit remember also
use commit rather than the generic race. Cancellation immediately revokes new
work, but the operation promise does not settle until every already dispatched
protected mutation promise has settled. Its policy subscription remains until
then. A mutation can commit during that interval; this is not rollback. A late
storage rejection is logged even when the public failure remains the policy or
caller cancellation. Turning the policy back on never reauthorizes the old call.

[代码/边界] Completion or failure closes the captured operation: even an otherwise
enabled policy cannot authorize reuse of a captured guard/commit after its owner
has returned (`memory/cancelled`). Reads and model/plugin candidate calls can
still be abandoned promptly, with late host writes blocked; their physical IO,
remote billing and plugin-side effects are not drained or undone. A permanently
unsettled write keeps cancellation pending rather than inventing a terminal
receipt. This change does not create public task states, a task registry or
public task ownership. Local inference coordination is supplied separately by
the digest queue. Direct domain edits such as user classification
and feedback retain their own lifetimes, outside the automatic-build policy.

[环境] [Memory write-drain evidence](./evidence/memory-commit-drain-2026-09-10.json)
uses isolated macOS debug, real SQLite writes and three Worker consumers. The
fixture holds delivery of a real port receipt after native completion, not the
SQLite transaction itself: cancellation stays pending with one policy subscription,
and only receipt release lets the operation reject/unsubscribe. A trigger-induced
native failure keeps event/outbox counts 8 to 8 and broadcasts unchanged; its
released late failure is logged as db/error while the caller gets ai/memory-disabled.
Fresh retry succeeds. Agent/Worker graph queries agree and compiled Memory Desk
shows the committed Drained entity. Unit tests independently gate seven write
destinations, drain sibling success/failure, block retained operations and retain
prompt hung-read/model cancellation. This is not a public-task UI or physical
network-cancellation test; packaged/Windows/Linux/remote sync remain unverified.

[代码/边界] Ordinary chat, raw transcript persistence, existing-memory retrieval,
annotations, user deletion and plugin-owned goal storage remain available. This
is not erasure or a prohibition on processing retained history after re-enable.
Already dispatched storage writes are not transactionally undone by cancellation;
already invoked plugin providers may finish their own side effects, although the
host stops waiting and cannot promote their late results. The policy does not
make the host's unfinished profile/entity projections complete.

[代码] Reading Goals is a practical composition of reader header/command views,
book-scoped private durable storage, context and memory candidate contributions,
and exact `ai.preferences.buildMemory` access. Context follows the request's book,
not whichever book is currently open; memory suggestion is opt-in. Clear removes
the private goal, not already promoted memories. Forms capture their target book
and save goal and host policy independently. No dedicated Agent goal-editing tool
is registered; no new host domain or plugin-ID branch was needed.

[环境] The real Worker, native chat UI and controlled loopback inference verified
goal context, candidate promotion, disabled memory with retained chat history,
in-flight cancellation, no resurrection, fresh work after re-enable, and SQLite
failures for goal/policy/insight writes. The source plugin is not release-bundled;
marketplace install/restart, packaged CSP, remote inference semantics and other
desktop platforms were not tested for this plugin. Narrow-window body scrolling
exists; keyboard focus traversal and every off-screen control remain unverified.
See [structured evidence](./evidence/memory-build-policy-2026-09-09.json).

Plugin access is declared in `settingsAccess` with exact paths or explicit
`section.*` groups. `discover`, `read`, and `write` are separate grants. An app
theme scheduler can write `appearance.theme` without gaining access to AI,
sync, shortcuts, or unrelated reader settings.

Secrets are never settings values. Secret fields reference plugin-scoped
secret slots and are fulfilled only through the Secrets service.

Plugin-owned setting definitions are declared in the manifest and enter the
same Settings catalog under `plugins.<plugin-id>.*`. The host renders them and
routes changes through the same validation and notification machinery.

Settings chooses among capabilities; contributions supply choices. The active
theme, font, voice, and reader mode are settings. The available themes, fonts,
voices, and modes are contributions.

## 7. Contributions

The canonical contribution roster is:

| ID | Plugin supplies | Host owns |
| --- | --- | --- |
| `selectionActions` | selection action and handler | selection menu and invocation UX |
| `headerActions` | reader/library action and view | toolbar/page placement and accessibility |
| `commands` | command metadata and handler | registry, palette, shortcuts |
| `settingsOptions` | dynamic options for a declared plugin field | settings form and validation |
| `voiceProviders` | voice discovery and synthesis | selected voice, playback, fallback |
| `contentProviders` | virtual book content loader | library binding, navigation, presentation |
| `readerModes` | bounded text segmentation behavior | reader lifecycle and controls |
| `agentTools` | tool schema and executor | approval, orchestration, presentation |
| `agentContextProviders` | bounded per-turn reference blocks | provenance, size limits, prompt placement |
| `agentRetrievalProviders` | searchable private source | tool schema, query/limit bounds, result clipping |
| `memoryCandidateProviders` | possible durable memories | scope validation, deduplication, persistence |
| `themes` | semantic app/reader theme data | validation, selection, generated CSS |
| `fonts` | metadata and approved font assets | loading, picker, active selection |
| `syncTransports` | a ciphertext mailbox on a remote of the plugin's choosing (WebDAV, S3, …) | encryption, event log, cursors, merge, connect ritual, scheduling |

All contribution registries use the same ownership rules:

- IDs are namespaced by plugin ID;
- registrations are validated and inspectable;
- registration returns a disposable;
- replacing a registration cannot be undone by a stale disposable;
- deactivation and failed activation dispose in reverse order;
- late asynchronous results from a retired generation cannot overwrite its
  replacement.

A genuinely new contribution kind needs a deliberate host consumer. After that
consumer and registry entry exist, any installed plugin may register into it
without being named by the host.

Plugins do not register React components, JSX, HTML, CSS, iframes, arbitrary
DOM, or unnamed mount points.

### Agent intelligence contributions

The three agent-facing providers are deliberately narrower than direct prompt
or memory access:

- A Context Provider receives the current thread scope and user text. Its
  output is host-stamped with plugin provenance, clipped, capped, serialized as
  untrusted reference data, and appended only to the current turn.
- A Retrieval Provider becomes a namespaced agent tool. The host owns the
  `query`/`limit` schema, caps item count and content length, and exposes the
  plugin name in the tool description and result.
- A Memory Candidate Provider runs after a completed turn. It may propose a
  small set of `fact`, `preference`, `insight`, or `summary` candidates. The
  host maps book scope, rejects cross-scope or malformed candidates, removes
  exact duplicates, and writes accepted items through the canonical Memory
  port with plugin provenance.

Plugins never receive the product Memory port, cannot inject system rules, and
cannot write a long-term memory directly. A contribution supplies evidence or
a candidate; the host remains the consumer and decision boundary.

### Sync transports

`syncTransports` (`sync:transport`) lets a plugin provide an alternative sync
backend. The boundary is drawn at ciphertext: the host's sync engine seals
every event and blob before they reach the plugin and opens them only after
they come back, so a transport never sees event types, payloads, book bytes,
keys, or the roaming secrets sealed in the log — only opaque envelopes plus
their routing fields (event id, HLC stamp).

The transport contract is dumb storage, not a protocol peer:

- per-device, dense, immutable event batches (`listEventBatches` /
  `getEventBatch` / create-only `putEventBatch`);
- blobs in the engine's v1/v2 envelope formats (main object, sealed parts,
  and a commit that must verify completeness before writing the descriptor);
- small named meta objects with create-only `putMetaIfAbsent` — the
  first-writer-wins ritual key material relies on.

Everything order-sensitive stays host-side: `platform/sync/transport-feed.ts`
folds the per-device batches into the engine's single monotonic pull cursor
through a locally persisted append-only journal (loss of which costs a
re-download, never data), and `platform/sync/transport-registry.ts` is where
registrations land. Connecting runs the same passphrase ritual as the relay
(`establishEncryptionWithStore`), binds the profile to the session's
`endpointId`, and is mutually exclusive with a relay account — one outbox, one
mailbox. Transports classify failures by throwing errors with stable `sync/*`
codes; uncoded failures are retried with backoff.

First party: `plugins/webdav-sync` (marketplace-distributed, not bundled).

## 8. Host Services

The current host services are:

| ID | Contract | Permission |
| --- | --- | --- |
| `storage` | plugin-scoped KV and document collections | built in |
| `secrets` | plugin-scoped credential slots | built in |
| `ui` | host toast and save/export flow | built in |
| `schedules` | 1.1: bind, list, observe, pause/resume and run declared tasks | built in, own schedules only |
| `session` | 2.0: environment snapshot/observation only; reading state requires the reading domain | built in |
| `plugins` | 1.0: bounded installed public metadata list/observation | built in |
| `maintenance` | 1.0: updater snapshot/observation, release check and native maintenance controls | built in; check requires `service:network` |
| `sync` | 1.0: sanitized status, backlog, account quotas, sync request and host settings | `service:sync` |
| `network` | host HTTP client | `service:network` |
| `llm` | approved one-shot/structured model calls | `service:llm` |
| `clipboard` | write text to clipboard | `service:clipboard` |

[代码] Maintenance 1.0 exposes `snapshot()`, `observe(handler)`,
`openSettings("updates"|"diagnostics")`, and optional `checkForUpdates()` when
`service:network` is granted. State includes support, phase, nullable versions,
progress, error stage and selected/last-successfully-checked channel. Local
snapshot/observation never checks the network. Observers are initial and serial,
coalesce intermediate changes, cap at 64, and retire with the plugin. Checks
use the host release feed only, share the native UI flight, and cannot overlap
installation. Channel changes invalidate old checks/candidates, including a
change back to the original channel. Check errors reject with stable codes,
not an up-to-date result; raw details stay in host logs. Cancellation before
acceptance prevents dispatch; after acceptance it only cancels the caller's
delivery, not another caller's shared check. Unsupported checks reject.

`openSettings` waits for About page acknowledgement and a mounted target control,
then scrolls/focuses it and returns `{status:"opened",surface}` only. It does not
assemble/export/send a diagnostic bundle or download/install/restart the app.
Those actions remain host UI-owned, including report preview and explicit send
confirmation. No log contents, paths, report IDs, credentials or raw payloads
are exposed. Agent `get_software_update` and `open_maintenance_settings` use the
same service in both scopes; checking is explicit opt-in. SYS16's bounded actor
entry is connected; SYS15 still lacks plugin-owned diagnostic output and final
flow receipts. Focused checks cover wiring, not real desktop update/diagnostics
execution; composition/Tauri acceptance remains pending.

[代码] Sync 1.0 exposes `snapshot()`, `observe(handler)`, `backlog()`, `account()`,
`requestSync()`, and `openSettings()`. Its separate `service:sync` grant is not
implied by network access or a sync transport contribution. Snapshot contains
connection availability, scheduler phase/counters, last success/error code,
cycle-start backlog and remaining backfill, never account/email IDs, keys,
blob identities, raw cursors or tickets. `backlog()` queries current local counts;
it is not the same sample as cycle-start totals. Observation sends an initial
snapshot and coalesced changes serially (64 subscriptions maximum), not an event
replay stream. Failures in local counts reject rather than returning zero.

`account()` is an explicit remote query for relay tier, billing availability,
usage and four quota limits; it returns null for disconnected/transport/preview
states, not for network failures. It excludes all identity and key fields and
rejects malformed quota values. Connection-operation/restart generations reject
late account or cycle results after a connection change. `requestSync()` reuses
the scheduler; disabled/unauthenticated/busy connections fail, `already-running`
means no new cycle, and `completed` means that cycle ended, not that all devices
or backfill have converged. Caller cancellation prevents dispatch or delivery,
not shared physical sync or rollback. `openSettings()` waits for the host Data &
Sync page and returns only `opened`, not workspace/library data or completed
login, disconnect, deletion or purchase. Targeted flows and their final receipts
remain unconnected. Agent `get_sync_status` and `manage_sync` share this service
in both scopes; manual sync asks approval, account fetching is opt-in. Focused
checks passed; new composition/native/cross-device acceptance remains pending.

[代码] Schedules 1.1 retains `bind(id,run)` and adds `list({offset?,limit?})`,
`observe(query,handler)`, and `control(id,"pause"|"resume"|"run")`. Plugins only
see/control their own bound declarations (64 maximum per plugin). Lists return
1–100 entries, default 50; observers deliver initial and serial coalesced changes.
Pause/resume persist on this device. A manual run bypasses pause/cadence once,
without resuming automatic execution; pause does not stop an active callback.
The host saves the attempt before invoking the callback, then separately saves
finish/outcome/success/error code. Only callback and final write completion
return `completed`; duplicate runs return `already-running`. Latest state is not
a complete execution history. Legacy `schedule-runs` stamps become start times,
never successes; unfinished records show `interrupted`. Both `schedule-state`
and `schedule-runs` are reserved host keys excluded from preference roaming.
The first sweep waits five seconds, later sweeps run each minute, cadence has a
15-minute floor, and missed periods coalesce to one attempt. No execution while
the app is closed, no exact timing or OS jobs. Rebinding does not overlap an old
flight; retirement prevents new callbacks/late result writes and drains already
dispatched state writes, not arbitrary callback side effects. The last binding
releases scheduler timers. Global Agent `list_plugin_schedules` and
`manage_plugin_schedule` use the same controller with approval for each control;
book scope has neither tool. Focused checks passed; composition/Tauri lifecycle
acceptance remains pending.

[代码] UI 1.7 adds `openExternal(url)` when `service:network` is granted.
It accepts HTTP(S) only (up to 8192 characters), rejects credentials and control
characters, and delegates to the system opener. Completion means OS dispatch,
not remote page load; custom schemes, local files and OAuth tickets remain
outside this API. Agent `open_external_url` uses the same host implementation.
Both are explicit-user-intent operations, never a background data export path.

[代码] Agent `copy_to_clipboard` now shares the plugin clipboard writer (text
only, up to 1000000 characters). `export_text_file` uses the same native save
flow as plugin `ui.exportFile`; user cancellation returns `saved:false`/`false`.
The shared export accepts text or bytes up to 64 MiB, copies accepted bytes,
and rechecks cancellation after the save dialog before dispatching the write.
The model tool accepts text only; a suggested filename grants no path access.
Dispatched clipboard/file effects are not rolled back by subsequent cancellation.

[代码] `services.plugins.list({search?,offset?,limit?})` and `observe(query,handler)`
return public `id/name/version/builtin/enabled/activationFailed`, total and next
offset. Limit is 1–100 (default 50), offset is nonnegative, search at most 200
characters. Observation emits the initial page and installed-state changes and
is activation-owned. No settings, paths, credentials or raw activation errors
are exposed. Enabled describes configuration, not contribution health. Restart
offset pagination after changes. Agent `list_installed_plugins` shares this
query; provider discovery/invocation and management approvals are separate work.

[环境] These new connections have type and focused contract/permission tests.
Combination plugins and native E2E are intentionally deferred to the integrated
validation phase; existing export evidence does not prove this new batch.

Services are not a native escape hatch. Never expose raw paths, unrestricted
filesystem access, Tauri invocation, SQL, Foliate internals, arbitrary process
execution, or a generic host invoke method.

[代码] `services.session.environment()` returns a fresh shared
`HostEnvironmentSnapshot`: `revision`, `runtime` (`desktop`/`preview`),
`platform` (`macos`/`windows`/`linux`/`unknown`), `locale`, nullable IANA `timeZone`,
`utcOffsetMinutes` (east of UTC, including DST), and `networkHint`
(`online`/`offline`/`unknown`). Revision belongs to this host instance, increases
only on changed facts, and is not a durable cross-restart cursor. The Agent's
`get_host_environment` in both scopes reads the same store; abort is checked
before and after the read. No book, account, credentials or device identifiers
are returned, so this metadata requires no reading grant.

[代码] `observeEnvironment(handler)` delivers an immediate snapshot then changed
revisions. Locale and online/offline/focus/pageshow events refresh it; timezone
and DST also refresh every 30 seconds while observed. Every query refreshes.
Subscribers receive independent copies; callback failures are logged, not
propagated into other subscribers. Explicit dispose and plugin unload release
the subscription; the last observer releases listeners and the timer. No
exactly-once or durable replay is promised. Plugins needing these methods declare
`requires.services.session: "^2.0.0"`.

[代码/环境] Listening Desk 0.7 consumes this service for a localized offline hint
on view refresh. It does not disable Start on that hint, including system voice.
The shared store, actual Agent tool and zero-permission Worker were tested in
isolated macOS debug Tauri; the built Listening Desk Worker returned the localized
hint. [Evidence](./evidence/host-environment-2026-09-09.json) distinguishes actual
language changes from controlled navigator/event injection. Network hints do not
prove endpoint reachability, model/account readiness, or supported format
availability. Those availability gaps remain open. Real OS timezone/network changes, packaged and other platforms are not
validated by this test.

[代码] Session 2.0 removes `subscribe`, `PluginSessionEventMap` and
`PluginSessionEventName`; App no longer separately emits book-opened/book-closed,
chapter-changed or reading-progress. Plugins declare `reading:read` (or write)
and use `domains.reading.queries.session()` / `events.observeSession()` instead.
The snapshot distinguishes idle/loading/ready/error, identifies book/session,
and carries location/history/mode/playback/revision. Its observer immediately
delivers current state, so late activation does not require replaying an event.
There is no no-permission compatibility bridge; a `services.session: ^1.x`
requirement is rejected before activation. Origin/reason and complete revocation
and cross-platform behavior still require further verification.

[代码] Dictionary 1.2 replaces its event-maintained title cache with on-demand
reading + library queries under explicit `reading:read` and `library:read`
permissions. It rechecks book/session identity after reading metadata; a switch,
close or reopen drops that title, while a read failure rejects instead of
pretending absence. Lookup cache identity now includes title as a prompt input,
so entries are not reused across different book contexts. Older cache entries
are not used by the new keys; saved vocabulary is unchanged. Installed plugin
updates follow the normal permission-consent policy; compiled built-ins follow
the existing host-owned bundled policy, not a newly introduced consent bypass.

[环境] [Session boundary evidence](./evidence/reading-session-boundary-2026-09-09.json)
covers isolated macOS debug Tauri. A zero-permission Worker has only the two
metadata methods and no reading domain; a read-only Worker immediately receives
the already-open FB2 session, then PDF loading/ready and closed/idle updates,
without write commands. The actual built Dictionary Worker uses three seeded
cache entries to verify late activation, book switching and close select the
correct contextual result. Host inference is disabled during this probe, then
restored; it is not remote LLM, word-card rendering, or installation-upgrade E2E.

## 9. Permissions

The manifest permission vocabulary is derived from the catalogs:

- Domains: `library:read`, `library:write`, `reading:read`, `reading:write`,
  `annotations:read`, `annotations:write`, `conversations:read`, `conversations:write`, `memory:read`, `memory:write`.
- Contributions: `reader:modes`, `agent:tools`, `agent:context`,
  `agent:retrieval`, `agent:memory`, `ui:themes`, `sync:transport`.
- Services: `service:sync`, `service:network`, `service:llm`, `service:clipboard`.
- Settings: exact `settingsAccess` grants rather than a broad permission.

Write implies read within a domain. Permission-free contributions and services
are still explicit catalog entries; they are not ambient undocumented powers.

`reader:modes` is currently restricted to bundled plugins at activation time.

Meaningful permissions are shown in install consent. Capability compatibility
and permission are separate: a plugin must both request authority and declare a
compatible contract version.

## 10. Capability Versions

Each domain, contribution, service, and declarative schema has its own semantic
version in the host catalog. They do not share one global plugin API version.

Every valid manifest must contain `requires`, grouped by:

- `domains`;
- `contributions`;
- `services`;
- `schemas` (`views`, `settings`, `themes`).

Each entry is a semver range. Manifest validation rejects unknown families,
unknown IDs, and invalid ranges. Activation then resolves the plugin actor's
visible capability versions and rejects:

- a requirement the actor has not been granted;
- a requirement outside the host version range.

The same filtered version map is exposed read-only at runtime. Discovery does
not reveal internal domains, inaccessible settings, or permission-gated
capabilities.

When changing a capability:

- patch for compatible fixes;
- minor for backward-compatible additions;
- major for a breaking contract change.

Do not bump unrelated capabilities to avoid thinking about ownership.

## 11. Declarative UI

Plugin UI is data rendered by the host design system. Plugins provide validated
view models and callbacks. The host owns layout, focus, accessibility,
navigation, theme compatibility, and cleanup.

The versioned schema families are:

- `views` for plugin result and page views;
- `settings` for plugin setting forms;
- `themes` for semantic theme and font declarations.

A new UI need extends a bounded schema or creates a real contribution point. It
does not justify arbitrary web content or a plugin-owned React tree.

## 12. Lifecycle

### Discovery and activation

1. Enumerate bundled and installed plugin packages dynamically.
2. Parse and validate the manifest.
3. Validate capability requirements and permissions.
4. Resolve install consent where needed.
5. Construct the actor-scoped context in `activating` phase.
6. Start the plugin Worker with an activation timeout.
7. Run `activate(ctx)` as a read-and-declare pass. Registrations,
   subscriptions, schedules, and providers stay staged and globally invisible.
8. Drain every activation RPC and ping the Worker for health.
9. Run a required data migration, if any, with storage-only authority.
10. Cross the explicit promotion point: publish staged registrations and set
    both host and Worker to `active`.

During `activating`, domain commands, Settings updates, plugin storage writes,
secret access, UI effects, network, LLM, clipboard, and reader navigation throw.
Queries and plugin-private reads are available so a plugin can validate its
environment. Partial promotion is rolled back in reverse registration order.
No candidate contribution replaces the active version before promotion.

### Deactivation

Deactivation first returns the context to a non-writing phase, then removes
subscriptions, contributions, schedules, commands, tools, provider
registrations, UI sessions, and the Worker instance. Disposables are
generation-aware so an old runtime cannot remove a newer replacement.

### Plugin data schemas

Every manifest declares a positive integer `schemaVersion`, independent of the
plugin package version. The host stores the last committed value in a
host-owned namespace, outside plugin-writable KV.

When the value changes, the candidate may export `migrate(ctx, change)`. The
migration context exposes only plugin KV and document collections. It has no
domains, Settings commands, secrets, network, UI, contributions, or agent
surface. `change` contains `fromVersion`, `toVersion`, and an explicit
`upgrade` or `downgrade` direction.

The first runtime that introduces schema tracking adopts a plugin's declaration
as its baseline when no migration exists. A plugin with a migration hook may
handle that adoption as `0 -> schemaVersion`, which is how RSS moves its legacy
KV array into documents. After a committed schema exists, any upgrade or
downgrade without `migrate()` is rejected.

Migrations must be deterministic and idempotent. On migration failure or
timeout, the host restores the exact KV, document, schema-metadata, and file
snapshots. Deliberately installing an older version uses the same protocol with
`direction: "downgrade"`; a failed downgrade leaves the current version intact.

### Install and update

Local folders, zip archives, and marketplace payloads all enter the same staged
candidate flow. Staging is inert and does not replace the active plugin.

For an update, the host:

1. stages the candidate under a separate token;
2. starts the candidate in read-only `activating` phase and health-checks it
   while the previous version remains available;
3. quiesces and drains the previous runtime, then snapshots plugin KV,
   document data, and committed data-schema metadata;
4. commits the candidate to the active on-disk slot;
5. verifies the committed manifest and version;
6. refreshes the candidate's KV mirror from the post-quiescence host state;
7. runs upgrade/downgrade migration with storage-only authority;
8. promotes the candidate's staged contributions;
9. switches runtime ownership.

On failure it stops and drains the candidate. Files are rolled back only after
their commit, and data is restored only once migration could have changed it.
A health-check failure does not restore a stale snapshot over the still-live
previous runtime. The previous runtime is restarted only if quiescence was
attempted. Desktop startup also repairs an interrupted file switch when
possible. Domain events and secret mutations are not rollback storage; the
activation barrier makes them impossible before the promotion boundary.

Storage service v2 keeps `get()` synchronous but makes `set()` and `remove()`
awaitable durable writes; `flush()` waits for pending namespace writes. Worker
writes use ordinary RPC acknowledgements and participate in migration drain.
Committed schema metadata also waits for persistence. Host snapshots and Worker
pending overlays are separate, so an older failure cannot erase a newer write.
Roamed writes carry their origin through persistence instead of relying on a
synchronous mute flag. These changes have source/unit evidence; actual desktop
upgrade failure tests and cross-surface concurrent writes remain in the delivery
ledger, not declared fully verified here.

### Uninstall

Built-in plugins cannot be uninstalled. For an installed plugin, uninstall
deactivates it, removes active/candidate/rollback files, clears its document
collections, and removes enablement state. KV settings, secret slots, and
committed schema metadata are retained so reinstall can recover and migrate
user configuration.

## 13. First-Party Coverage

The thirteen source plugins use the registry-backed contract. Rust currently bundles
six; source presence is not installation or enablement. Theme Schedule is in the
adjacent distribution repository, not a fourteenth plugin in this checkout:

| Plugin | Primary capabilities |
| --- | --- |
| Dictionary | selection/header actions, commands, agent tools, retrieval provider, storage, authorized reading/library queries, LLM, views |
| Editorial Themes | theme/font contributions and theme schema |
| RSS Reader | Library, Reading, content provider, commands, agent tools, storage, schedule, network, views/settings |
| Sentence Reader | reader mode, storage, settings schema |
| Text to Speech | voice/options providers, storage, secrets, network, settings schema |
| Theme Schedule | Settings domain, options/commands, storage/UI, committed schedule, settings schema |
| WebDAV Sync | sync transport, storage, secrets, network, settings schema |
| Jumper | reader header, navigation TOC, precise search, shared locations/history |
| Annotation Desk | live paged annotations and error recovery (0.2), frozen conditional edits, export, views |
| Listening Desk | reading mode/provider control, unit navigation, playback/history, environment offline hint |
| Reading Goals | book goals, context provider, opt-in memory candidates, exact host memory setting, durable storage/views |
| Workspace Profiles | settled settings snapshots, exact path grants, atomic presets, private documents, shelf header/command views and Agent tool |
| Text Desk | library text preparation/tasks, single/shelf multi-query search, snippets, paged status views, reader header/command and explicit book navigation |
| Library Desk | workspace/collection navigation, live host-command discovery and guarded execution with typed resource pickers (0.6), command search, grouped native selection, live selection count, explicit batch review/removal, durable pending-file discovery and safe retry |
| Memory Desk | memory search, protected chapter graphs, source navigation and conditional correction/pin/unpin/forget (0.2); shared Agent queries and manage_memory, no duplicate plugin tool |

The host never switches on these plugin IDs. Product-specific behavior belongs
in their packages and registered capabilities.

## 14. Extension Procedure

When adding a domain:

1. Prove it owns coherent product state or behavior.
2. Add its ID, access policy, and version to the domain catalog.
3. Add its runtime definition to the exhaustive domain registry.
4. Define typed queries, commands, and events in the owning domain module.
5. Expose the actor-safe contract in plugin types and context construction.
6. Add permission, actor-view, worker-shape, and domain contract tests.
7. Regenerate the marketplace declaration mirror.

When adding a contribution:

1. Define the host consumer and why an existing point is insufficient.
2. Add the catalog entry, version, and permission policy.
3. Use the shared contribution registry with plugin-scoped identity.
4. Define validation, invocation, and disposal semantics.
5. Add host rendering/invocation and stale-generation tests.

When adding a service:

1. Keep the operation bounded and typed.
2. Add the catalog entry, version, and permission policy.
3. Implement host-side validation and the Worker bridge.
4. Define cancellation, quotas, audit behavior, and failure semantics.
5. Do not add a generic native escape hatch.

When adding a setting:

1. Add one Settings catalog definition.
2. Declare supported targets, validation, options, sensitivity, and actor policy.
3. Route product UI, agent, and plugin access through the same domain path.
4. Add exact scope and committed-event tests.

## 15. Verification Contract

Before declaring plugin work complete, verify:

- core capability catalog tests;
- manifest and semver negotiation tests;
- actor-domain and settings-scope tests;
- contribution ownership and stale-generation tests;
- Worker shape, activation timeout, and health tests;
- activation-phase side-effect barrier and staged-registration tests;
- schema upgrade, downgrade, timeout, and exact data-restore tests;
- bounded agent context, retrieval, and memory-candidate consumer tests;
- staged update and rollback tests;
- plugin package tests and public declaration mirror validation;
- root typecheck and test suites;
- the real Tauri desktop app, never only the browser build.

For lifecycle changes, exercise install, enable, disable, update success, update
failure, rollback, and uninstall. Confirm no contribution, listener, schedule,
or Worker survives disposal.

## 16. Non-Negotiable Rules

1. Settings stays inside the Domain Registry.
2. Appearance stays a Settings section.
3. Do not solve missing product behavior with plugin storage or a special UI
   API.
4. Do not let a setting own provider implementations.
5. Do not duplicate capability IDs, permissions, or versions.
6. Do not introduce a generic untyped invoke API.
7. Do not restore obsolete APIs for hypothetical compatibility.
8. Keep the Worker boundary and host-rendered declarative UI.
9. Keep secrets outside ordinary settings values.
10. Enforce exact semantic permissions at invocation time.
11. Keep plugin mutations on canonical domain commands or bounded services.
12. Verify shipping behavior in Tauri and persisted writes through the real
    storage path.
13. Keep `activate()` read-and-declare only; put data transformations in
    `migrate()` and runtime work behind committed registrations.
14. Agent extensions provide bounded data or candidates, never prompt or
    Memory-port authority.
