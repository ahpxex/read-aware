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

Current stable sections include General, Appearance, Reading, Annotations, Menus and
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

The ten source plugins use the registry-backed contract. Rust currently bundles
six; source presence is not installation or enablement. Theme Schedule is in the
adjacent distribution repository, not an eleventh plugin in this checkout:

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
