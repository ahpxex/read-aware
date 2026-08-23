# ReadAware Plugins - Agent Architecture Reference

> Audience: coding agents and maintainers.
>
> Decision status: approved on 2026-08-23. This document describes the target
> architecture. The repository has not completed this migration yet; the
> implementation-status section records the current gap.
>
> Compatibility policy: all existing plugins are first-party or bundled. A
> breaking rewrite is allowed. Do not preserve the old API with adapters,
> aliases, fallbacks, or compatibility shims.
>
> The concise human-facing version is [plugin-system.html](./plugin-system.html).

## 1. Decision

The plugin system has one capability model with three families:

1. **Domain Registry** - application state and behavior that already exists.
2. **Contribution Points** - new implementations or choices supplied by a
   plugin.
3. **Host Services** - bounded operating-system, infrastructure, and lifecycle
   facilities supplied by the host.

Every capability is defined once in its owning registry. Types, runtime
exposure, permissions, validation, worker bridging, events, documentation, and
tests must be derived from that definition rather than maintained as parallel
manual lists.

The plugin loader remains dynamic. Dynamic loading does not mean that arbitrary
plugin code may invent host behavior. It means a plugin can discover allowed
domains and register into existing contribution points without the host naming
that plugin in advance.

## 2. The Boundary Test

Use this test before adding any plugin API:

| Question | Capability family |
| --- | --- |
| Is this state or behavior ReadAware already owns? | Domain Registry |
| Is the plugin supplying a new implementation, choice, action, or provider? | Contribution Point |
| Does the plugin need the host to perform a bounded external operation? | Host Service |

Examples:

| Need | Correct owner |
| --- | --- |
| Read the active book | Reading domain |
| Change the selected app theme | Settings domain |
| Supply a new theme | Theme contribution |
| Read the selected voice | Settings domain |
| Supply a speech engine or voice | Voice-provider contribution |
| Navigate to another chapter | Reading domain |
| Add a selection action | Selection-action contribution |
| Call a remote dictionary API | Network host service |
| Store an API credential | Secrets host service |

Do not turn the three families into one generic string-addressed API. They have
different semantics, lifecycle, permission, and validation requirements. The
unification is a shared registry architecture, not a single untyped bag.

## 3. Domain Registry

### 3.1 Definition

A domain is a coherent slice of product behavior. A domain definition owns:

- its public read models;
- queries;
- commands;
- emitted events;
- validation and business invariants;
- actor access policy;
- persistence and synchronization classification.

Queries inspect state. Commands request state changes. Events report committed
changes. Plugins never write projection tables, Jotai atoms, SQLite, or feature
stores directly.

### 3.2 Actor-scoped views

The runtime resolves one registry into a view for an actor:

- `user` - product UI;
- `agent` - the core ReadAware agent;
- `plugin:<id>` - one installed plugin;
- `system` - trusted host pipelines.

The actor view exposes only the allowed domains, operations, records, and
fields. Permission checks happen again at invocation time; hiding an operation
from the generated API is not the security boundary by itself.

### 3.3 Target domain set

| Domain | Owns | Initial plugin exposure |
| --- | --- | --- |
| Library | books, source files, metadata, table of contents, collections, import and removal | Scoped reads and explicit commands |
| Reading | active reading session, location, navigation, progress, reading time, reader state | Reads, navigation, subscriptions |
| Annotations | highlights, notes, bookmarks, vocabulary references | Scoped reads and explicit mutations |
| Conversations | book and global threads, messages, conversation metadata | Narrow, consent-aware access |
| Settings | settings catalog, resolved values, target overrides, change events | Path-scoped discovery/read/write |
| Profile / Memory | user profile, derived memory, consolidation state | Internal at first; no broad plugin access |

The current `shelf` domain is not retained as a compatibility surface. Its
library concerns move to Library and its active-reading concerns move to
Reading.

New domains are added only when there is a real product ownership boundary.
Features, pages, React components, and menu locations are not domains by
default.

### 3.4 A single source of truth

One domain declaration must drive all of the following:

- TypeScript contracts;
- actor-facing API construction;
- permission vocabulary and manifest validation;
- worker RPC exposure;
- command argument and result validation;
- event subscription validation;
- capability introspection;
- generated reference documentation;
- contract tests.

Do not add a domain to the type package, plugin context, permission switch,
worker bridge, and test fixtures separately. That is the incomplete shape the
new registry replaces.

## 4. Settings Is a Domain

Settings is not a helper beside the Domain Registry. It is a first-class
domain because ReadAware owns settings state, validation, persistence, targets,
change semantics, and policy.

Appearance is not a domain. It is a section of Settings.

### 4.1 Settings sections

The initial catalog is organized into stable sections:

- General;
- Appearance;
- Reading;
- Menus and shortcuts;
- AI;
- Sync;
- Plugins.

Sections organize discovery and UI. They do not create separate runtime APIs.

### 4.2 Setting definitions

Each setting is described by one catalog record containing at least:

- stable path;
- section;
- value kind;
- default value;
- validation rules;
- static options or an option-provider reference;
- supported targets;
- readable actors;
- writable actors;
- sensitivity classification;
- local-only or synchronized persistence policy;
- canonical query and commit behavior;
- post-commit effects;
- user-facing label and consent description where needed.

Supported targets may include:

- global;
- all books;
- one book;
- one device.

Target support is declared per setting. A plugin cannot invent an unsupported
scope.

### 4.3 Settings operations

The Settings domain provides these semantic operations:

- discover permitted setting definitions;
- read resolved values;
- update a value at an allowed target;
- reset an override;
- subscribe to committed changes.

All writes use the same validation, persistence, event, and post-commit path as
the product UI and the agent. Plugins do not receive a raw settings object.

### 4.4 Permissions

Settings access is granted by exact paths or intentionally bounded path groups.
Installing a theme plugin must not imply write access to AI providers, sync,
shortcuts, or unrelated reader preferences.

The permission model must distinguish:

- discover;
- read;
- write;
- target scope;
- sensitive versus non-sensitive settings.

Secrets are never ordinary settings values. A setting may reference a secret
slot, but secret material is read and written only through the Secrets host
service.

### 4.5 Settings and contributions

Settings chooses among capabilities; contributions supply the choices.

- selected application theme: Settings;
- available application themes: Theme contributions;
- selected reader font: Settings;
- available reader fonts: Font contributions;
- selected read-aloud voice: Settings;
- available voices: Voice-provider contributions;
- selected reader mode: Settings;
- available modes: Reader-mode contributions.

Settings definitions owned by a plugin are registered into the Settings domain
under a plugin namespace. They are not a separate manifest-only configuration
system. Their values use the same discovery, validation, targeting, events, and
UI rendering rules as first-party settings.

## 5. Contribution Points

Contribution Points let plugins add implementations without taking ownership of
host state or rendering arbitrary product UI.

### 5.1 Initial roster

| Contribution point | Plugin supplies | Host owns |
| --- | --- | --- |
| Selection action | label, icon reference, eligibility, handler | selection menu, ordering, invocation UX |
| Header or page action | placement metadata and handler | toolbar/page layout and accessibility |
| Command | command metadata and handler | command registry, palette, shortcuts |
| Agent tool | schema, description, executor | tool approval, orchestration, result presentation |
| Theme | semantic theme tokens and metadata | active selection, validation, application |
| Font | font metadata and approved asset references | loading, caching, active selection |
| Voice provider | voice discovery and synthesis operations | selected voice, playback UX, policy |
| Reader mode | mode metadata and bounded reader behavior | active mode and reader lifecycle |
| Content provider | virtual-source metadata and content operations | navigation, library integration, presentation |

Plugin settings definitions belong to the Settings domain, not a fourth
contribution architecture. Scheduled jobs belong to lifecycle services, not a
visual mount point.

### 5.2 Contribution contract

Every contribution definition includes:

- stable plugin-scoped ID;
- contribution-point kind;
- metadata required by the host consumer;
- declared permissions;
- lifecycle hooks where relevant;
- validation rules;
- deterministic disposal behavior.

Registration returns a disposable handle. Deactivation, update failure, or
uninstall removes every contribution without leaving listeners, shortcuts,
styles, providers, or background work behind.

### 5.3 What dynamic means

The host does not enumerate plugin IDs. Any installed plugin may register a
valid contribution into an existing point.

A genuinely new kind of contribution still requires one explicit host consumer
because the host must know how to render, invoke, secure, and dispose it. Once
that point exists, plugins using it are loaded dynamically. Dynamic loading is
not permission for plugins to inject arbitrary DOM or create unnamed mount
points.

## 6. Host Services

Host Services expose bounded operations that cannot safely or consistently be
implemented inside a worker.

The initial service set is:

- plugin-scoped durable storage;
- secrets and credential slots;
- permission-aware network requests;
- approved LLM calls;
- clipboard operations;
- host-mediated file open, save, import, and export flows;
- schedules and lifecycle jobs;
- locale and non-sensitive environment metadata.

Each service has its own typed request and result contract, permission policy,
quotas where needed, cancellation behavior, and audit boundary. There is no
generic host invocation escape hatch.

Host Services must not expose:

- raw filesystem paths or unrestricted filesystem APIs;
- Tauri command invocation;
- SQLite connections or SQL;
- React, Jotai, or feature stores;
- raw DOM or WebView access;
- Foliate internals;
- arbitrary process execution.

## 7. Runtime Model

### 7.1 Load and activation

The runtime follows this sequence:

1. Discover installed plugin packages from the bundled catalog or plugin
   storage.
2. Validate the manifest and declared capability requirements.
3. Resolve permissions and user consent.
4. Start the plugin in a worker sandbox.
5. Construct an actor-scoped capability view from the registries.
6. Run activation and collect every returned registration and subscription.
7. Mark the plugin active only after activation completes successfully.

Activation is atomic from the product's perspective. Partial registrations are
disposed if any activation step fails.

### 7.2 Deactivation and uninstall

Deactivation cancels ongoing work and disposes:

- domain subscriptions;
- contributions;
- schedules;
- command and tool handlers;
- provider registrations;
- UI sessions;
- in-flight host-service requests where possible.

Uninstall additionally removes plugin-owned settings definitions and follows
the declared policy for plugin-scoped data and secrets. Destructive cleanup
must be explicit and consent-aware.

### 7.3 Updates and rollback

Never replace a running plugin in place.

1. Install the candidate version separately.
2. Validate its manifest and compatibility with the current host capability
   versions.
3. Run migration in a versioned transaction or recoverable staging area.
4. Activate the candidate and perform a health check.
5. Switch the active version only after success.
6. Retain the previous version until the new version is confirmed healthy.
7. Roll back code and recoverable data automatically on failure.

## 8. Security and Trust

First-party status reduces distribution risk; it does not remove the need for
capability isolation. Plugins still execute behind a worker boundary and use
least-privilege actor views.

Permission enforcement has several layers:

- manifest validation at install time;
- user consent for meaningful capabilities;
- actor-scoped API construction;
- invocation-time authorization;
- domain and service input validation;
- host-owned rendering and file pickers;
- lifecycle cleanup and cancellation;
- audit events for sensitive actions.

Permissions are semantic. Prefer `settings.write:appearance.theme` or a
similarly exact generated scope over broad implementation-oriented permissions.
Do not infer permission solely from whether a method happens to be present.

## 9. Host-Owned Plugin UI

Plugin UI remains declarative and host-rendered. Plugins provide view models,
commands, and event handlers; ReadAware renders them with `@read-aware/ui`.

This boundary provides:

- visual consistency;
- keyboard and accessibility guarantees;
- theme compatibility;
- controlled navigation;
- permission-aware inputs and file flows;
- cleanup when a plugin deactivates.

Do not expose arbitrary JSX, HTML, CSS, iframes, DOM handles, React component
registration, or WebView injection. A new UI need should extend the declarative
view schema or add a real host contribution point.

## 10. Capability Versioning and Discovery

The host publishes capability-family versions independently. Domains,
contribution points, host services, and declarative UI schemas do not have to
share one global version.

Before activation, the runtime checks the plugin's required capability ranges.
At runtime, a plugin may introspect only the capabilities visible to its actor
view. Discovery never reveals inaccessible setting paths, private fields, or
internal domains.

Because there are no third-party plugins today, migration should establish the
clean versioning model directly rather than emulate the old surface.

## 11. Current Implementation Status

### 11.1 What already works

The current system already has valuable pieces to retain:

- plugins are discovered and loaded as modules rather than hard-coded by ID;
- plugins run in a worker sandbox;
- activation and disposal lifecycle exists;
- several contributions are registered dynamically;
- plugin UI is declarative and host-rendered;
- permissions and install consent exist;
- host services exist for storage, network, LLM, and related operations;
- the agent settings implementation already models catalog metadata, targets,
  validation, draft changes, and commit behavior.

### 11.2 Structural problems to replace

The system is not yet fully registry-driven:

- `apps/web/src/domain/index.ts` manually composes only shelf, annotations, and
  conversations;
- domain type definitions, context construction, permission branches, worker
  exposure, and tests repeat capability knowledge;
- `ui:appearance` is exposed as a hand-built special case;
- settings are split between product UI, plugin manifest configuration, option
  providers, storage change listeners, and agent-only registries;
- some contributions use the main registry while settings option providers and
  virtual content providers use separate maps;
- the worker bridge can derive callable methods only from the context already
  assembled by the host, so it cannot repair a missing host capability;
- the `shelf` domain combines library ownership with reading-session concerns.

These are migration targets, not behavior to preserve.

### 11.3 First-party plugins to migrate

All current plugins move to the new contracts in the same migration:

- Dictionary;
- Editorial Themes;
- RSS Reader;
- Sentence Reader;
- Text to Speech;
- Theme Schedule, where present in the bundled or marketplace source tree.

Do not ship parallel old and new plugin runtimes.

## 12. Migration Plan

### Phase 1: Freeze product behavior

- Inventory every domain method, permission, contribution, service, setting,
  plugin UI view, and lifecycle hook currently used by first-party plugins.
- Add behavior-level contract tests around those user-visible workflows.
- Record which old APIs are unused and can be deleted rather than migrated.

### Phase 2: Build the capability runtime

- Create the shared registry primitives and actor identity model.
- Make permission vocabulary and capability discovery derive from registry
  declarations.
- Generate the plugin-facing context and worker RPC surface from the actor view.
- Add invocation-time authorization, validation, cancellation, and disposal.

### Phase 3: Promote Settings

- Move the useful catalog model from the agent settings implementation into the
  product-level Settings domain.
- Route product UI and agent settings access through the same domain.
- Add target resolution, reset, subscriptions, and exact permission scopes.
- Register plugin-owned settings definitions under plugin namespaces.
- Replace the special Appearance API with Settings paths and theme/font
  contributions.

### Phase 4: Rebuild product domains

- Split shelf behavior into Library and Reading.
- Register Annotations and Conversations through the same domain definition
  mechanism.
- Keep Profile / Memory internal until an explicit plugin contract is designed.
- Route all domain changes through canonical event-sourced commands.

### Phase 5: Unify contributions and services

- Move every contribution point under one contribution registry abstraction.
- Move option-provider and virtual-content registrations out of standalone maps.
- Normalize IDs, validation, ownership, disposal, and introspection.
- Give each Host Service a typed, independently permissioned contract.

### Phase 6: Migrate plugins and delete the old API

- Migrate all first-party plugins.
- Remove old context types, manual permission switches, appearance special
  cases, manifest-only settings behavior, duplicate registries, and obsolete
  tests.
- Do not add a compatibility adapter after deletion.

### Phase 7: Verify the shipping product

- Run unit, contract, type, and activation rollback tests.
- Exercise every plugin in the Tauri desktop app, not the browser build.
- Verify settings changes persist and emit events through SQLite/event sourcing.
- Verify install, enable, disable, update failure, rollback, and uninstall.
- Verify no plugin leaves registrations, schedules, or listeners after disposal.

## 13. Acceptance Criteria

The migration is complete only when all of these are true:

- adding a domain operation requires changing one domain definition, not several
  manual mirrors;
- adding a setting makes it available to allowed UI, agent, and plugin actors
  through the same catalog and command path;
- Appearance has no standalone plugin API;
- plugins receive exact settings scopes rather than a raw settings bag;
- installed plugins are not named in host registration code;
- all contribution points share ownership, validation, and disposal semantics;
- the worker API is generated from the actor-scoped capability view;
- every mutation crosses a domain command or bounded Host Service;
- arbitrary DOM, React, filesystem, SQL, Tauri, and process access remain
  unavailable;
- activation is atomic and updates can roll back;
- first-party plugins use only the new runtime;
- obsolete plugin APIs and compatibility code are deleted;
- the complete workflows pass in the Tauri desktop app.

## 14. Rules for Future Agents

1. Treat this document as the target architecture until a newer explicit
   decision replaces it.
2. Do not create a separate Settings registry beside the Domain Registry.
3. Do not create an Appearance domain. Appearance is a Settings section.
4. Do not solve a missing domain capability with plugin storage or a special
   UI API.
5. Do not treat a contribution as domain state or let a setting own provider
   implementations.
6. Do not duplicate capability lists across packages or runtime layers.
7. Do not introduce a generic untyped invoke API.
8. Do not preserve the old API for hypothetical third-party compatibility.
9. Keep the worker sandbox and host-owned declarative UI.
10. Keep secrets outside ordinary settings values.
11. Keep plugin permissions exact, semantic, and enforced at invocation time.
12. Verify product behavior in Tauri and verify persisted mutations through the
    event-sourced storage path.
