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

> Audit guidance updated 2026-09-09: use the [unified capability model](./host-capability-model.md)
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
| Annotations | highlights and notes | `annotations:read`, `annotations:write` |
| Conversations | book/global threads and message summaries | `conversations:read` |
| Settings | catalog, resolved values, targets, validation, change events | exact path grants |

Profile and Memory remain internal. A page, React feature, menu, or route is not
a domain merely because it has a name.

There is no `shelf` domain. Library ownership and active reading behavior are
separate. Do not restore `shelf` as an alias.

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
Native UI and remote edits still lack a complete versioned settings-domain
change feed; see CFG10 in the capability matrix.

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
is visible in screenshots. UI02 and CFG10 retain their remaining gaps.

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
| `schedules` | bind a manifest-declared periodic task | built in |
| `session` | 2.0: environment snapshot/observation only; reading state requires the reading domain | built in |
| `network` | host HTTP client | `service:network` |
| `llm` | approved one-shot/structured model calls | `service:llm` |
| `clipboard` | write text to clipboard | `service:clipboard` |

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
  `annotations:read`, `annotations:write`, `conversations:read`.
- Contributions: `reader:modes`, `agent:tools`, `agent:context`,
  `agent:retrieval`, `agent:memory`, `ui:themes`, `sync:transport`.
- Services: `service:network`, `service:llm`, `service:clipboard`.
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

The twelve source plugins use the registry-backed contract. Rust currently bundles
six; source presence is not installation or enablement. Theme Schedule is in the
adjacent distribution repository, not a thirteenth plugin in this checkout:

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
| Annotation Desk | paged annotations, conditional edits, export, views |
| Listening Desk | reading mode/provider control, unit navigation, playback/history, environment offline hint |
| Reading Goals | book goals, context provider, opt-in memory candidates, exact host memory setting, durable storage/views |
| Workspace Profiles | settled settings snapshots, exact path grants, atomic presets, private documents, shelf header/command views and Agent tool |
| Text Desk | library text preparation state, paged status views, reader header/command and explicit book navigation |

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
