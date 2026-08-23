import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../lib/site";

export const Route = createFileRoute("/docs/plugins/")({
  head: () => ({
    meta: [
      { title: "Plugin system — ReadAware Docs" },
      {
        name: "description",
        content:
          "How ReadAware plugins extend product domains, contribute new capabilities, use host services, and stay inside explicit trust boundaries.",
      },
    ],
  }),
  component: PluginsOverviewPage,
});

function PluginsOverviewPage() {
  return (
    <article className="doc-prose">
      <h1>Plugin system</h1>
      <p className="lead">
        ReadAware plugins can work with reading data, add native actions and
        providers, extend the reading assistant, and ask the host for bounded
        services. Installed packages load dynamically; the app never needs a
        switch for each plugin ID.
      </p>

      <h2>One model, three capability families</h2>
      <p>
        Every executable plugin capability has one of three shapes. Choosing
        the right shape is the first authoring decision.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr><th>Family</th><th>Use it when</th><th>Examples</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Domain</strong></td>
              <td>ReadAware already owns the state or behavior.</td>
              <td>Library, reading, annotations, conversations, settings</td>
            </tr>
            <tr>
              <td><strong>Contribution</strong></td>
              <td>The plugin supplies a new choice or implementation.</td>
              <td>Actions, commands, voices, content, themes, agent providers</td>
            </tr>
            <tr>
              <td><strong>Service</strong></td>
              <td>The host must perform a bounded external operation.</td>
              <td>Storage, secrets, schedules, network, LLM, clipboard</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Declarative view, settings, and theme schemas sit beside these
        families. They describe host-rendered data; they do not grant another
        source of authority.
      </p>

      <h2>Settings is a domain</h2>
      <p>
        Appearance is a Settings section, not a separate plugin API. A plugin
        that changes the selected theme requests exact Settings paths such as{" "}
        <code>appearance.theme</code>. A plugin that supplies a new theme uses
        the <code>themes</code> contribution. Choosing and supplying are
        deliberately separate powers.
      </p>

      <h2>What plugins can add</h2>
      <ul>
        <li>Selection and header actions, command-palette commands, and host-rendered views.</li>
        <li>Voices, virtual-book content providers, reader modes, themes, and fonts.</li>
        <li>Agent tools, per-turn context, searchable private sources, and memory candidates.</li>
        <li>Plugin settings, dynamic options, recurring work, storage, and encrypted secrets.</li>
        <li>Reads, commands, and committed event subscriptions across granted product domains.</li>
      </ul>
      <p>
        Browse the complete, versioned roster in the{" "}
        <Link to="/docs/plugins/capabilities">capability browser</Link>. It
        also includes a permission preview for <code>manifest.json</code>.
      </p>

      <h2>Native UI, by construction</h2>
      <p>
        Plugins do not mount React, HTML, CSS, iframes, or arbitrary DOM. They
        return validated view data and callbacks; ReadAware owns layout,
        navigation, accessibility, theme compatibility, loading states, and
        cleanup. New visual freedom arrives as a bounded schema or a real host
        contribution point, not a generic webview escape hatch.
      </p>

      <h2>The trust boundary</h2>
      <p>
        Each plugin runs in its own module Worker. It has no DOM, Tauri,
        SQLite, filesystem, or process handle, and ambient network and browser
        persistence APIs are disabled. Host calls cross a message boundary and
        are resolved against the plugin's actor-scoped capability view.
      </p>
      <p>
        This limits accidental and direct overreach, but installation remains
        a software trust decision. Before code runs, ReadAware shows semantic
        permissions and exact Settings grants. Capability requirements are
        checked separately: permission answers “may it do this?”, while a
        version requirement answers “can it use this contract correctly?”
      </p>

      <h2>Activation and updates are transactional</h2>
      <p>
        <code>activate()</code> is a read-and-declare phase. Registrations stay
        invisible while the host drains calls and health-checks the Worker;
        writes, secrets, network, LLM, clipboard, UI effects, and navigation
        are blocked. Persistent data changes run later through a storage-only{" "}
        <code>migrate()</code>. Only a healthy, migrated candidate is promoted.
      </p>
      <p>
        Updates snapshot files, plugin KV, document collections, and committed
        schema metadata. A failed activation or migration restores the previous
        files and data, then restarts the prior runtime when needed.
      </p>

      <h2>Current ecosystem</h2>
      <p>
        The plugins shipping today are built-in or first-party: Dictionary,
        Editorial Themes, RSS Reader, Sentence Reader, TTS Voices, and Theme
        Schedule. The public{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          readaware-plugins repository
        </a>{" "}
        contains the authoring template, public declarations, validation, and
        marketplace registry. There is no legacy third-party API to preserve;
        the current contract is the baseline.
      </p>

      <h2>Start building</h2>
      <p>
        Follow <Link to="/docs/plugins/develop">Build a plugin</Link> for the
        local loop, use the <Link to="/docs/plugins/api">API reference</Link>{" "}
        while implementing, and read{" "}
        <Link to="/docs/plugins/publishing">Publishing</Link> before submitting
        a marketplace change.
      </p>
    </article>
  );
}
