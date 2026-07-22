import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../lib/site";

export const Route = createFileRoute("/docs/plugins/publishing")({
  head: () => ({
    meta: [
      { title: "Publishing a plugin — ReadAware Docs" },
      {
        name: "description",
        content:
          "How to submit a plugin to the ReadAware marketplace: repository layout, validation, and review expectations.",
      },
    ],
  }),
  component: PublishingPage,
});

function PublishingPage() {
  return (
    <article className="doc-prose">
      <h1>Publishing a plugin</h1>
      <p className="lead">
        The marketplace works like Raycast's extension repository: your plugin
        lives in the public{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          readaware-plugins
        </a>{" "}
        repository and lands via pull request. Once merged, it appears in the
        app under Settings → Plugins → Marketplace and installs with one
        click.
      </p>

      <h2>Author in TypeScript</h2>
      <p>
        TypeScript is the recommended path. The repository ships a{" "}
        <code>template/</code> with the typed API
        (<code>types/plugin-api.d.ts</code>) wired up — copy it, write{" "}
        <code>src/main.ts</code>, and build a single self-contained module:
      </p>
      <pre>
        <code>bun build src/main.ts --outfile main.js --format esm</code>
      </pre>
      <p>
        What ships is always the built <code>main.js</code>; keep{" "}
        <code>src/</code> committed so reviewers can read the real code. Plain
        JavaScript is equally accepted. The official plugins in{" "}
        <code>plugins/</code> are authored this way — use them as living
        examples.
      </p>

      <h2>Submitting</h2>
      <ol>
        <li>Fork the repository.</li>
        <li>
          Copy <code>template/</code> to{" "}
          <code>plugins/&lt;your-plugin-id&gt;/</code>, containing at least{" "}
          <code>manifest.json</code> and <code>main.js</code>. The folder name
          must equal the manifest <code>id</code>.
        </li>
        <li>
          Add a matching entry to <code>registry.json</code>, keeping the array
          sorted by id.
        </li>
        <li>
          Run the same checks CI will run:
          <pre>
            <code>{`node scripts/validate.mjs
npx tsc --noEmit`}</code>
          </pre>
        </li>
        <li>
          Open a pull request describing what the plugin does and why it needs
          each permission it declares.
        </li>
      </ol>
      <p>
        CI enforces registry–manifest consistency, id shape, the permission
        whitelist, and file existence, and type-checks every TypeScript
        plugin.
      </p>

      <h2>Updates</h2>
      <p>
        Same flow: bump <code>version</code> in both <code>manifest.json</code>{" "}
        and <code>registry.json</code> in one pull request. Note the app reads
        the registry through a CDN, so a merged update can take a little while
        to appear in the marketplace tab.
      </p>

      <h2>Review expectations</h2>
      <ul>
        <li>
          Declare the minimum permissions. Pull requests asking for more than
          the code uses will be sent back — see the{" "}
          <Link to="/docs/plugins/api">permission table</Link>.
        </li>
        <li>
          <code>main.js</code> must be readable, or accompanied by the source
          it was bundled from.
        </li>
        <li>No obfuscated code, no analytics or tracking, no remote code loading.</li>
      </ul>
      <p>
        Plugins run inside the app with the same access as the app itself.
        Installation is a trust decision users make per plugin, and this
        review is the community's first line of defense — write plugins you
        would be comfortable installing from a stranger.
      </p>
    </article>
  );
}
