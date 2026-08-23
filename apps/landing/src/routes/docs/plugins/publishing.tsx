import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../lib/site";

export const Route = createFileRoute("/docs/plugins/publishing")({
  head: () => ({
    meta: [
      { title: "Publishing a plugin — ReadAware Docs" },
      {
        name: "description",
        content:
          "Prepare, validate, review, and submit a ReadAware plugin to the public marketplace repository.",
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
        Marketplace packages live in the public{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          readaware-plugins repository
        </a>{" "}
        and enter through review. The current catalog is first-party; this
        process is also the contract for opening it to external submissions.
      </p>

      <h2>Prepare a reviewable package</h2>
      <p>
        TypeScript is recommended. Keep <code>src/</code> beside the built,
        self-contained <code>main.js</code> so reviewers can compare source and
        artifact. Commit every runtime asset. Do not load remote code, hide
        behavior in generated blobs, or depend on files outside the package.
      </p>
      <pre><code>{`plugins/my-plugin/
  manifest.json
  main.js
  package.json
  tsconfig.json
  src/main.ts
  assets/…`}</code></pre>

      <h2>Run the repository checks</h2>
      <pre><code>{`bun run build
bun run typecheck
bun test
bun run validate`}</code></pre>
      <p>
        Validation checks registry-to-manifest consistency, IDs, versions,
        capability requirements, permissions, declared files, and package
        shape. These checks are necessary, not sufficient: exercise the built
        folder in ReadAware desktop before submitting it.
      </p>

      <h2>Submit</h2>
      <ol>
        <li>Fork the public repository.</li>
        <li>Copy the template into <code>plugins/&lt;plugin-id&gt;/</code> and keep the folder name equal to the manifest ID.</li>
        <li>Add the package and every required runtime asset.</li>
        <li>Add the matching, ID-sorted entry to <code>registry.json</code>.</li>
        <li>Run all four root checks and test local installation from the built folder.</li>
        <li>Open a pull request describing behavior, private data, external services, and the reason for every permission and Settings grant.</li>
      </ol>

      <h2>Review checklist</h2>
      <ul>
        <li>The feature uses the narrowest existing Domain, Contribution, and Service capabilities.</li>
        <li><code>requires</code> names every used contract with a defensible semver range.</li>
        <li>Permissions and <code>settingsAccess</code> match actual runtime calls and contain no speculative authority.</li>
        <li><code>activate()</code> registers behavior but performs no business or external side effects.</li>
        <li>Plugin-private data has a stable schema and every version transition has a tested migration.</li>
        <li>Network endpoints, LLM use, credentials, schedules, and data retention are explained in user-facing language.</li>
        <li>Host-rendered views work with keyboard navigation, long text, empty data, and light and dark themes.</li>
        <li>Source is readable; generated output is reproducible; no analytics, tracking, obfuscation, or remote code loading is present.</li>
      </ul>
      <p>
        The <Link to="/docs/plugins/capabilities">permission preview</Link> is a
        useful preflight. Repository validation and human review remain the
        authoritative checks.
      </p>

      <h2>Updates and data migration</h2>
      <p>
        Bump the package version in both <code>manifest.json</code> and{" "}
        <code>registry.json</code>. Bump <code>schemaVersion</code> only when
        private KV or document shape changes, and ship the corresponding{" "}
        <code>migrate()</code> in the same candidate.
      </p>
      <p>
        Test update and deliberate downgrade against realistic data. ReadAware
        stages and health-checks the candidate, snapshots plugin files and
        data, quiesces the old runtime for migration, and promotes only after
        success. A failed update must leave the previous package and data
        usable.
      </p>

      <h2>Permission changes</h2>
      <p>
        Treat new authority as a product change, not manifest housekeeping.
        Explain why the previous permission set is insufficient, which user
        data or external operation becomes reachable, and what happens when the
        user declines. Remove permissions that the code no longer uses.
      </p>

      <h2>Distribution trust today</h2>
      <p>
        Worker isolation and capability enforcement reduce overreach, but
        installation is still a trust decision. Before a broad third-party
        marketplace, ReadAware still needs publisher identity, deterministic
        packaging, signing and integrity verification, review provenance,
        revocation, permission-diff review, and a security response path.
      </p>
      <p>
        Until those controls ship, a merged repository entry is review evidence,
        not a mathematical guarantee that arbitrary hostile code is safe.
      </p>

      <h2>Before opening the pull request</h2>
      <p>
        Re-read <Link to="/docs/plugins/develop">Build a plugin</Link>, compare
        the final manifest in the{" "}
        <Link to="/docs/plugins/capabilities">capability tools</Link>, and
        confirm the package follows the current{" "}
        <Link to="/docs/plugins/api">API contract</Link> rather than an older
        <code>shelf</code> or <code>appearance</code> example.
      </p>
    </article>
  );
}
