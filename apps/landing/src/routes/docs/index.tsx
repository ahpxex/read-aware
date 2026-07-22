import { Link, createFileRoute } from "@tanstack/react-router";
import { REPO_URL } from "../../lib/releases";
import { DISCORD_URL } from "../../lib/site";

export const Route = createFileRoute("/docs/")({
  head: () => ({
    meta: [
      { title: "Documentation — ReadAware" },
      {
        name: "description",
        content:
          "How to install ReadAware, get reading, and extend the app with plugins.",
      },
    ],
  }),
  component: DocsOverview,
});

function DocsOverview() {
  return (
    <article className="doc-prose">
      <h1>Documentation</h1>
      <p className="lead">
        ReadAware is an AI-native reading app: one reader for EPUB, MOBI, AZW3,
        FB2, and PDF that builds memory across your books, highlights, and
        conversations. It is free, local-first, and runs on your own AI key.
      </p>

      <h2>Start here</h2>
      <ul>
        <li>
          <Link to="/docs/install">Download &amp; install</Link> — installers
          for macOS, Windows, Linux, and Android, and what to do when your OS
          warns about an unsigned app.
        </li>
        <li>
          <Link to="/docs/getting-started">Getting started</Link> — import your
          books, read and annotate, connect an AI provider, and understand
          where your data lives.
        </li>
      </ul>

      <h2>Extend the app</h2>
      <ul>
        <li>
          <Link to="/docs/plugins">Plugin system</Link> — what plugins can do
          and how the trust model works.
        </li>
        <li>
          <Link to="/docs/plugins/api">API reference</Link> — the full
          authoring contract: manifest, lifecycle, permissions, contributions,
          and views.
        </li>
        <li>
          <Link to="/docs/plugins/publishing">Publishing</Link> — how to get
          your plugin into the in-app marketplace.
        </li>
      </ul>

      <h2>Elsewhere</h2>
      <p>
        The app is developed in the open at{" "}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        . For questions, bug reports, or to show what you built, join the{" "}
        <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
          Discord
        </a>{" "}
        or open an issue.
      </p>
    </article>
  );
}
