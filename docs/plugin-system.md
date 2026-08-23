# ReadAware Plugins - Agent Reference

> Audience: coding agents and maintainers.
>
> Status: implemented architecture as of 2026-08-23. This is a description of
> the running contract, not a migration proposal.
>
> Compatibility policy: the current ecosystem is first-party. Do not add old
> API aliases, adapters, fallbacks, or compatibility shims.
>
> Concise human-facing version: [plugin-system.html](./plugin-system.html).

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
| Worker boundary and derived RPC shape | `plugin-worker-host.ts`, `plugin-sandbox.worker.ts` |
| Contribution ownership and inspection | `state/contribution-registry.ts`, `state/plugin-store.ts` |
| Install/update transaction | `runtime/plugin-update-transaction.ts`, desktop `plugins.rs` |

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
- allowed domains;
- allowed contribution registries;
- allowed host services.

Unavailable capabilities are absent. Invocation still crosses the worker
boundary and resolves against the host-side actor context, so hiding a method is
not the only authorization check.

The plugin runs in a module Worker. It has no React, Jotai, DOM, WebView,
Tauri, SQLite, filesystem, or process handle. All host interaction crosses the
typed context.

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

Every domain write uses the same canonical command path as the product and is
stamped with origin `plugin:<id>`. Plugins never mutate projections, feature
stores, or SQLite directly.

## 6. Settings Is a Domain

Settings is not a helper beside the domain system. It is a first-class domain
because ReadAware owns settings state, catalog metadata, validation, target
resolution, persistence, and change effects.

Appearance is a Settings section, not a domain and not a service.

Current stable sections include General, Appearance, Reading, Menus and
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
| `themes` | semantic app/reader theme data | validation, selection, generated CSS |
| `fonts` | metadata and approved font assets | loading, picker, active selection |

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

## 8. Host Services

The current host services are:

| ID | Contract | Permission |
| --- | --- | --- |
| `storage` | plugin-scoped KV and document collections | built in |
| `secrets` | plugin-scoped credential slots | built in |
| `ui` | host toast and save/export flow | built in |
| `schedules` | bind a manifest-declared periodic task | built in |
| `session` | subscribe to bounded reading-session events | built in |
| `network` | host HTTP client | `service:network` |
| `llm` | approved one-shot/structured model calls | `service:llm` |
| `clipboard` | write text to clipboard | `service:clipboard` |

Services are not a native escape hatch. Never expose raw paths, unrestricted
filesystem access, Tauri invocation, SQL, Foliate internals, arbitrary process
execution, or a generic host invoke method.

## 9. Permissions

The manifest permission vocabulary is derived from the catalogs:

- Domains: `library:read`, `library:write`, `reading:read`, `reading:write`,
  `annotations:read`, `annotations:write`, `conversations:read`.
- Contributions: `reader:modes`, `agent:tools`, `ui:themes`.
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
5. Construct the actor-scoped context.
6. Start the plugin Worker with an activation timeout.
7. Collect registrations and subscriptions.
8. Ping the Worker for health.
9. Mark active only after activation and health both succeed.

Partial activation is rolled back in reverse registration order.

### Deactivation

Deactivation removes subscriptions, contributions, schedules, commands, tools,
provider registrations, UI sessions, and the Worker instance. Disposables are
generation-aware so an old runtime cannot remove a newer replacement.

### Install and update

Local folders, zip archives, and marketplace payloads all enter the same staged
candidate flow. Staging is inert and does not replace the active plugin.

For an update, the host:

1. stages the candidate under a separate token;
2. snapshots recoverable plugin KV and document data;
3. starts and health-checks the candidate while the previous version remains
   available;
4. commits the candidate to the active on-disk slot;
5. verifies the committed manifest and version;
6. switches runtime ownership;
7. retires the previous instance only after success.

On failure it stops the candidate, restores the previous files, restores the KV
namespace and document collections, and restarts the previous runtime. Desktop
startup also repairs an interrupted file switch when possible.

Activation must not perform irreversible domain writes or secret migrations.
KV and plugin documents are recoverable during the transaction; domain events
and secret-store mutations are deliberately not treated as rollback storage.

### Uninstall

Built-in plugins cannot be uninstalled. For an installed plugin, uninstall
deactivates it, removes active/candidate/rollback files, clears its document
collections, and removes enablement state. KV settings and secret slots are
retained so reinstall can recover user configuration.

## 13. First-Party Coverage

The current first-party plugins all use the registry-backed contract:

| Plugin | Primary capabilities |
| --- | --- |
| Dictionary | selection/header actions, commands, agent tools, storage, session, LLM, views |
| Editorial Themes | theme/font contributions and theme schema |
| RSS Reader | Library, Reading, content provider, commands, agent tools, storage, schedule, network, views/settings |
| Sentence Reader | reader mode, storage, settings schema |
| Text to Speech | voice/options providers, storage, secrets, network, settings schema |
| Theme Schedule | Settings domain, options/commands, storage/UI, settings schema |

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
