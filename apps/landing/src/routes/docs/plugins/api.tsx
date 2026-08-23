import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../lib/site";

export const Route = createFileRoute("/docs/plugins/api")({
  head: () => ({
    meta: [
      { title: "Plugin API reference — ReadAware Docs" },
      {
        name: "description",
        content:
          "The current ReadAware plugin contract: manifest, capabilities, domains, contributions, services, declarative UI, lifecycle, and migrations.",
      },
    ],
  }),
  component: PluginApiPage,
});

function PluginApiPage() {
  return (
    <article className="doc-prose">
      <h1>Plugin API reference</h1>
      <p className="lead">
        A plugin is a folder with <code>manifest.json</code> and a built ES
        module. The exact public TypeScript contract ships as{" "}
        <code>types/plugin-api.d.ts</code> in the{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          readaware-plugins repository
        </a>. This page explains how its pieces fit together.
      </p>

      <h2>Package shape</h2>
      <pre><code>{`my-plugin/
  manifest.json
  main.js
  src/main.ts       # recommended and committed for review
  assets/           # optional, explicitly listed for marketplace installs`}</code></pre>
      <p>
        <code>main.js</code> default-exports a lifecycle object. ReadAware runs
        it in a dedicated module Worker and hands <code>activate</code> an
        actor-scoped context.
      </p>
      <pre><code>{`export default {
  activate(ctx) {
    // Inspect and register. Side effects are blocked in this phase.
  },
  migrate(storageCtx, change) {
    // Optional: transform plugin-private KV and documents.
  },
  deactivate() {
    // Optional: release the plugin's own external resources.
  },
};`}</code></pre>

      <h2>Manifest</h2>
      <pre><code>{`{
  "id": "theme-schedule",
  "name": "Theme Schedule",
  "version": "0.1.0",
  "schemaVersion": 1,
  "minAppVersion": "0.3.0",
  "requires": {
    "domains": { "settings": "^1.0.0" },
    "contributions": {
      "commands": "^1.0.0",
      "settingsOptions": "^1.0.0"
    },
    "services": {
      "storage": "^1.0.0",
      "schedules": "^1.0.0",
      "ui": "^1.0.0"
    },
    "schemas": { "settings": "^1.0.0" }
  },
  "settingsAccess": {
    "discover": ["appearance.theme", "reading.theme"],
    "write": ["appearance.theme", "reading.theme"]
  },
  "main": "main.js"
}`}</code></pre>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Field</th><th>Contract</th></tr></thead>
          <tbody>
            <tr><td><code>id</code></td><td>Lowercase letters, digits, and hyphens; maximum 64 characters. It is the permanent namespace and must equal the folder name.</td></tr>
            <tr><td><code>name</code>, <code>version</code></td><td>User-facing name and package version.</td></tr>
            <tr><td><code>schemaVersion</code></td><td>Required positive integer for plugin-private KV and document data. Independent of package version.</td></tr>
            <tr><td><code>requires</code></td><td>Required map of capability IDs to semver ranges, grouped by domains, contributions, services, and schemas.</td></tr>
            <tr><td><code>permissions</code></td><td>Optional semantic authority requested from the user. Unknown values fail validation.</td></tr>
            <tr><td><code>settingsAccess</code></td><td>Optional discover/read/write grants for exact setting paths or explicit <code>section.*</code> groups.</td></tr>
            <tr><td><code>minAppVersion</code></td><td>Optional app-version floor. Use it when the package depends on a newly shipped capability.</td></tr>
            <tr><td><code>settings</code></td><td>Optional host-rendered plugin setting fields.</td></tr>
            <tr><td><code>schedules</code></td><td>Optional recurring tasks, declared before their handlers are bound.</td></tr>
            <tr><td><code>themes</code>, <code>fonts</code></td><td>Optional declarative theme and font contributions; requires <code>ui:themes</code>.</td></tr>
            <tr><td><code>main</code></td><td>Entry module relative to the folder; defaults to <code>main.js</code>.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Use the <Link to="/docs/plugins/capabilities">capability browser</Link>{" "}
        for the complete roster and permission vocabulary. A requirement is
        always a compatibility claim; it never grants authority.
      </p>

      <h2>Runtime context</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Namespace</th><th>Contains</th></tr></thead>
          <tbody>
            <tr><td><code>ctx.manifest</code></td><td>The validated manifest, read-only.</td></tr>
            <tr><td><code>ctx.appVersion</code>, <code>ctx.locale</code></td><td>Host version and current UI locale.</td></tr>
            <tr><td><code>ctx.lifecycle.phase</code></td><td><code>activating</code>, <code>migrating</code>, or <code>active</code>.</td></tr>
            <tr><td><code>ctx.capabilities</code></td><td>Only the capability versions visible to this plugin actor.</td></tr>
            <tr><td><code>ctx.domains</code></td><td>Granted ReadAware-owned state and behavior.</td></tr>
            <tr><td><code>ctx.contributions</code></td><td>Registries into which the plugin may supply implementations.</td></tr>
            <tr><td><code>ctx.services</code></td><td>Bounded host operations and plugin-private infrastructure.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Permission-gated namespaces are absent when not granted. Every Worker
        call is also authorized host-side; hiding a method is not the only
        check. Registrations return a disposable and are reclaimed in reverse
        order when activation fails or the plugin is disabled.
      </p>

      <h2>Domains</h2>
      <p>
        A Domain exposes <code>queries</code>, optional <code>commands</code>,
        and committed <code>events.subscribe</code>. Commands use the same
        event-sourced write path as ReadAware and are attributed to{" "}
        <code>plugin:&lt;id&gt;</code>. Write permission implies read.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Domain</th><th>Queries and commands</th><th>Authority</th></tr></thead>
          <tbody>
            <tr>
              <td><code>library</code></td>
              <td>Books, metadata, source chapter text, TOC, collections; import, edit, star, remove, virtual books, and collection commands.</td>
              <td><code>library:read</code> / <code>library:write</code></td>
            </tr>
            <tr>
              <td><code>reading</code></td>
              <td>Per-book and aggregate reading stats; mark finished, open a book, and navigate to CFI or href.</td>
              <td><code>reading:read</code> / <code>reading:write</code></td>
            </tr>
            <tr>
              <td><code>annotations</code></td>
              <td>Filter highlights, notes, and passive ask traces; create, edit, recolor, and remove highlights or notes.</td>
              <td><code>annotations:read</code> / <code>annotations:write</code></td>
            </tr>
            <tr>
              <td><code>conversations</code></td>
              <td>Read book threads, list global threads, and read a thread. Writes stay with the chat runtime.</td>
              <td><code>conversations:read</code></td>
            </tr>
            <tr>
              <td><code>settings</code></td>
              <td>Discover permitted catalog entries, read resolved values, update supported targets, and subscribe to committed changes.</td>
              <td>Exact <code>settingsAccess</code> grants</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        There is no <code>shelf</code> or <code>appearance</code> domain.
        Library data and active reading behavior are separate. Appearance is a
        section inside Settings.
      </p>

      <h3>Settings access</h3>
      <p>
        <code>discover</code>, <code>read</code>, and <code>write</code> are
        independent. Grant exact paths whenever possible; use a section group
        such as <code>appearance.*</code> only when the feature genuinely needs
        the whole section. Updates go through the catalog's validation, target
        policy, persistence, and post-commit effects.
      </p>
      <pre><code>{`const entries = await ctx.domains.settings.queries.discover({
  section: "appearance",
});

await ctx.domains.settings.commands.update([
  {
    path: "appearance.theme",
    value: "dark",
    target: { kind: "global" },
  },
]);`}</code></pre>

      <h2>Contributions</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Registry</th><th>Plugin supplies</th><th>Permission</th></tr></thead>
          <tbody>
            <tr><td><code>selectionActions</code></td><td>Selection action and handler returning a toast or host-rendered view.</td><td>None</td></tr>
            <tr><td><code>headerActions</code></td><td>Reader or library action, placement metadata, and view callback.</td><td>None</td></tr>
            <tr><td><code>commands</code></td><td>Command metadata and handler.</td><td>None</td></tr>
            <tr><td><code>settingsOptions</code></td><td>Dynamic options for one declared plugin field.</td><td>None</td></tr>
            <tr><td><code>voiceProviders</code></td><td>Voice list and encoded-audio synthesis.</td><td>None</td></tr>
            <tr><td><code>contentProviders</code></td><td>Sections for a virtual book key.</td><td>None</td></tr>
            <tr><td><code>readerModes</code></td><td>Bounded reader segmentation mode; currently bundled-only.</td><td><code>reader:modes</code></td></tr>
            <tr><td><code>agentTools</code></td><td>Tool schema, human label, description, and executor.</td><td><code>agent:tools</code></td></tr>
            <tr><td><code>agentContextProviders</code></td><td>Bounded current-turn reference blocks.</td><td><code>agent:context</code></td></tr>
            <tr><td><code>agentRetrievalProviders</code></td><td>Search results from plugin-owned data.</td><td><code>agent:retrieval</code></td></tr>
            <tr><td><code>memoryCandidateProviders</code></td><td>Possible durable facts, preferences, insights, or summaries.</td><td><code>agent:memory</code></td></tr>
            <tr><td><code>themes</code>, <code>fonts</code></td><td>Manifest-declared semantic theme and font data.</td><td><code>ui:themes</code></td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Every contribution ID is namespaced by plugin, every registration is
        owned and inspectable, and stale disposables cannot remove a newer
        replacement. A new contribution kind still needs a deliberate host
        consumer; after that, any compatible plugin can register without being
        named by the app.
      </p>

      <h3>Agent extension boundaries</h3>
      <ul>
        <li><strong>Context providers</strong> run for one turn. The host adds provenance, caps size, and serializes output as untrusted reference data.</li>
        <li><strong>Retrieval providers</strong> become namespaced tools with a host-owned <code>query</code>/<code>limit</code> schema and clipped results.</li>
        <li><strong>Memory candidate providers</strong> propose bounded candidates after a turn; the host validates scope, deduplicates, and performs any durable write.</li>
      </ul>
      <p>
        Plugins never receive the Memory port, cannot inject system rules, and
        cannot write long-term memory directly.
      </p>

      <h2>Host services</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Service</th><th>Contract</th><th>Permission</th></tr></thead>
          <tbody>
            <tr><td><code>storage</code></td><td>Namespaced KV, document collections, and external-change notifications.</td><td>None</td></tr>
            <tr><td><code>secrets</code></td><td>Namespaced encrypted credential slots.</td><td>None</td></tr>
            <tr><td><code>ui</code></td><td>Host toast and save/export flow.</td><td>None</td></tr>
            <tr><td><code>schedules</code></td><td>Bind a handler to a manifest-declared cadence.</td><td>None</td></tr>
            <tr><td><code>session</code></td><td>Subscribe to bounded reading-session facts.</td><td>None</td></tr>
            <tr><td><code>network</code></td><td>Host-mediated HTTP.</td><td><code>service:network</code></td></tr>
            <tr><td><code>llm</code></td><td>One-shot text or JSON-schema-constrained model calls using the user's configuration.</td><td><code>service:llm</code></td></tr>
            <tr><td><code>clipboard</code></td><td>Write text to the system clipboard.</td><td><code>service:clipboard</code></td></tr>
          </tbody>
        </table>
      </div>

      <h3>Storage</h3>
      <p>
        Use KV for small settings and checkpoints. Use a named document
        collection for plugin-owned records with stable IDs and optional{" "}
        <code>bookId</code>/<code>anchor</code> provenance. Provenance is an
        index, not ownership; a document may survive deletion of the referenced
        book. Uninstall clears document collections but retains KV, secret
        slots, and committed schema metadata for reinstall and migration.
      </p>

      <h3>Schedules</h3>
      <p>
        The manifest declares <code>{`{ id, label, everyMinutes }`}</code> and
        activation binds the handler through{" "}
        <code>ctx.services.schedules.bind</code>. The minimum cadence is 15
        minutes. Runs happen at least at that cadence while the app is open,
        catch up after launch when overdue, and do not overlap. This is not a
        durable background job or an exact-time guarantee.
      </p>

      <h2>Declarative UI and settings</h2>
      <p>
        Plugins return versioned view data, not executable UI. The view grammar
        includes markdown, searchable lists, forms, detail layouts, dictionary
        results, and bounded block trees. Handlers may keep the surface, show a
        toast, open or replace a view, reset navigation, close the surface, or
        return field errors. The host owns loading and failure states for
        promises.
      </p>
      <p>
        Manifest settings use host controls for text, textarea, number, time,
        select, choice, checkbox, toggle, and secret fields. Conditional fields
        use <code>visibleWhen</code>; dynamic selects use a registered{" "}
        <code>settingsOptions</code> provider. Secret fields write directly to
        encrypted secret slots and never enter the ordinary settings object or
        the agent-visible catalog.
      </p>

      <h2>Themes and fonts</h2>
      <p>
        Theme plugins declare semantic data in the manifest. An app theme
        overrides a fixed host token vocabulary; a reader theme supplies the
        required six-color page palette and optional typography defaults. The
        host validates values, generates CSS, loads approved local font files,
        and applies nothing until the user selects it.
      </p>
      <p>
        Supplying choices needs <code>ui:themes</code>. Selecting one needs an
        exact Settings write grant such as <code>appearance.theme</code> or{" "}
        <code>reading.theme</code>. One does not imply the other.
      </p>

      <h2>Lifecycle phases</h2>
      <ol>
        <li><strong>Activating:</strong> queries and plugin-private reads are available; registrations are staged; side effects are blocked.</li>
        <li><strong>Migrating:</strong> only plugin KV and document collections are available.</li>
        <li><strong>Active:</strong> promoted handlers may use their granted domains, contributions, and services.</li>
      </ol>
      <p>
        The host drains activation RPCs, health-checks the Worker, runs any data
        migration, then promotes the full staged set at one explicit point.
        Failed activation disposes staged work without replacing the current
        runtime.
      </p>

      <h2>Worker environment</h2>
      <p>
        There is no React, Jotai, DOM, WebView, Tauri, SQLite, filesystem, or
        process access. Ambient <code>fetch</code>, WebSocket, EventSource,
        XMLHttpRequest, BroadcastChannel, IndexedDB, and Cache Storage are
        disabled. Use the typed context for network, persistence, and every
        host interaction.
      </p>

      <h2>Compatibility and stability</h2>
      <p>
        Domains, contributions, services, and declarative schemas each carry
        an independent semantic version. Unknown IDs, invalid semver ranges,
        inaccessible required capabilities, and incompatible host versions
        prevent activation. Compatible additions bump the owning capability,
        not one global plugin API number.
      </p>
      <p>
        The current ecosystem is first-party, so the present registry-backed
        contract is the baseline. Do not rely on earlier <code>shelf</code>,{" "}
        <code>appearance</code>, or pre-registry shapes.
      </p>
    </article>
  );
}
