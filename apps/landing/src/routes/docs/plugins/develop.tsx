import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../lib/site";

export const Route = createFileRoute("/docs/plugins/develop")({
  head: () => ({
    meta: [
      { title: "Build a plugin — ReadAware Docs" },
      {
        name: "description",
        content:
          "Create, validate, install, migrate, and test a ReadAware plugin with the public TypeScript template.",
      },
    ],
  }),
  component: DevelopPluginPage,
});

function DevelopPluginPage() {
  return (
    <article className="doc-prose">
      <h1>Build a plugin</h1>
      <p className="lead">
        Start from the public TypeScript template, declare the smallest
        capability set, and exercise the built package in the ReadAware desktop
        app. The host owns lifecycle, permissions, presentation, and rollback;
        your plugin owns its behavior and private data.
      </p>

      <h2>Prerequisites</h2>
      <ul>
        <li>ReadAware desktop, with access to Settings → Plugins.</li>
        <li><a href="https://bun.sh" target="_blank" rel="noopener noreferrer">Bun</a> for the repository scripts.</li>
        <li>A checkout or fork of the{" "}
          <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">readaware-plugins repository</a>.
        </li>
      </ul>

      <h2>Create the package</h2>
      <ol>
        <li>Copy <code>template/</code> to <code>plugins/&lt;your-plugin-id&gt;/</code>.</li>
        <li>Keep the folder name, manifest <code>id</code>, and runtime namespace identical.</li>
        <li>Edit <code>manifest.json</code> and <code>src/main.ts</code>.</li>
        <li>Delete template contributions you do not use and remove their permissions.</li>
        <li>Build the self-contained <code>main.js</code> that ReadAware loads.</li>
      </ol>
      <pre><code>{`bun run build
bun run typecheck
bun test
bun run validate`}</code></pre>

      <h2>Design the manifest before the implementation</h2>
      <p>Review the manifest in this order:</p>
      <ol>
        <li><strong>Identity</strong> — stable ID, name, package version, author, and minimum app version.</li>
        <li><strong>Data</strong> — positive integer <code>schemaVersion</code> and migration path.</li>
        <li><strong>Compatibility</strong> — a semver range in <code>requires</code> for every API and schema used.</li>
        <li><strong>Authority</strong> — semantic <code>permissions</code> and exact <code>settingsAccess</code> grants.</li>
        <li><strong>Declarations</strong> — settings, schedules, themes, fonts, and entry module.</li>
      </ol>
      <p>
        Use the <Link to="/docs/plugins/capabilities">capability browser and permission preview</Link>{" "}
        before installing. Requirements are compatibility claims, not user
        authority; permission-free capabilities still belong in{" "}
        <code>requires</code> when your plugin depends on their contract.
      </p>

      <h2>Choose the right capability</h2>
      <ol>
        <li>Use a <strong>Domain</strong> for state or behavior ReadAware owns.</li>
        <li>Use a <strong>Contribution</strong> to supply a choice, action, or provider.</li>
        <li>Use a <strong>Service</strong> for a bounded host operation.</li>
        <li>Use plugin storage only for plugin-owned data.</li>
        <li>Request a new typed host capability when no existing shape fits.</li>
      </ol>
      <p>
        Do not mirror books, progress, annotations, Settings, or memory into
        plugin storage. Shadow state bypasses product invariants, committed
        events, projection rebuilds, sync semantics, and agent context.
      </p>

      <h2>Keep activation declarative</h2>
      <p>
        During <code>activate(ctx)</code>, inspect the environment and register
        actions, commands, providers, subscriptions, and schedules. Do not
        perform business writes or external work. The host stages every
        registration until activation RPCs finish and the Worker answers a
        health ping.
      </p>
      <p>
        Start runtime work from a registered handler after promotion. If a
        handler returns a promise, let the host present loading and failure
        states. Keep references to external resources only when your optional{" "}
        <code>deactivate()</code> must close them; host registrations and
        subscriptions are disposed automatically.
      </p>

      <h2>Version private data explicitly</h2>
      <p>
        <code>schemaVersion</code> versions plugin KV and document collections;
        it is independent of the package version. Change it only when the
        private data shape changes. Export <code>migrate(storageCtx, change)</code>{" "}
        for every supported upgrade and downgrade after a schema has been
        committed.
      </p>
      <ul>
        <li>Migrations receive storage only: no domains, Settings, secrets, network, UI, LLM, or contributions.</li>
        <li>Make each transition deterministic and idempotent.</li>
        <li>Test a failure after partial writes; the host must restore KV, documents, files, and schema metadata exactly.</li>
        <li>Do not use a package-version check as a substitute for the data schema.</li>
      </ul>

      <h2>Install the working folder</h2>
      <ol>
        <li>Run the build and checks.</li>
        <li>Open ReadAware → Settings → Plugins → Install plugin.</li>
        <li>Select the built plugin folder and inspect the consent summary.</li>
        <li>Exercise the real feature in the desktop app.</li>
        <li>Rebuild and reinstall to test an update.</li>
      </ol>
      <p>
        A plain browser cannot verify plugin installation, Worker IPC, SQLite
        persistence, raw book access, reader integration, or rollback. Test the
        shipping Tauri app.
      </p>

      <h2>Test the lifecycle, not only the happy path</h2>
      <ul>
        <li>Fresh install, enable, disable, and re-enable without restarting.</li>
        <li>Successful update and downgrade across real data.</li>
        <li>Activation timeout, handler rejection, migration failure, and exact rollback.</li>
        <li>Uninstall cleanup: no surviving action, listener, schedule, provider, or Worker.</li>
        <li>Permission removal and permission expansion during an update.</li>
        <li>Long labels, empty states, keyboard navigation, and all host themes.</li>
      </ul>

      <h2>Know the current limits</h2>
      <p>
        Schedules run while ReadAware is open, at least at their declared
        cadence, with launch catch-up when overdue. They are not durable jobs:
        there is no execution while the app is closed, persisted queue,
        retry/backoff contract, or crash-resume guarantee.
      </p>
      <p>
        UI is available only at existing typed contribution points. A missing
        placement requires a host-owned contribution and consumer; arbitrary
        HTML or a generic native invoke API will not be added as a shortcut.
      </p>

      <h2>Next</h2>
      <p>
        Keep the <Link to="/docs/plugins/api">API reference</Link> beside your
        editor, then read <Link to="/docs/plugins/publishing">Publishing</Link>{" "}
        before preparing a registry pull request.
      </p>
    </article>
  );
}
