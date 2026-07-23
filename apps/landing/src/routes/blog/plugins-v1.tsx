import { Link, createFileRoute } from "@tanstack/react-router";
import { BlogPost } from "../../components/BlogPost";
import { getPost } from "../../lib/posts";
import { MARKETPLACE_REPO_URL } from "../../lib/site";

const SLUG = "plugins-v1";

export const Route = createFileRoute("/blog/plugins-v1")({
  head: () => {
    const post = getPost(SLUG);
    return {
      meta: [
        { title: `${post.text.en.title} — ReadAware Blog` },
        { name: "description", content: post.text.en.description },
      ],
    };
  },
  component: () => (
    <BlogPost slug={SLUG}>
      <p>
        ReadAware now has a plugin system. You can write a plugin in an
        evening, install it from a folder while you develop it, and submit it
        to a community marketplace where anyone can install it in one click.
      </p>

      <h2>What you can build</h2>
      <p>
        A plugin is a folder with a manifest and one JavaScript module, and it
        can contribute:
      </p>
      <ul>
        <li>
          <strong>Selection actions</strong> — select text in any book and act
          on it: send a word to Anki, translate a passage, post a quote to
          your notes app.
        </li>
        <li>
          <strong>Header buttons and pages</strong> — a popover on the reader's
          top bar, or a full page on the shelf.
        </li>
        <li>
          <strong>Commands</strong> — everything lands in the command palette
          automatically.
        </li>
        <li>
          <strong>Tools for the assistant</strong> — this is the one we care
          most about. A plugin can hand the reading agent a new tool, and the
          agent decides when to call it mid-conversation. "Which of these
          words are already in my Anki deck?" becomes answerable.
        </li>
        <li>
          <strong>Books that aren't files</strong> — a content provider serves
          chapters on demand, so an RSS feed can sit on your shelf and be
          read, highlighted, and discussed exactly like a book.
        </li>
      </ul>

      <h2>Native by construction</h2>
      <p>
        We took the interface philosophy from Raycast: plugins do not render
        their own UI. They declare views — markdown, lists, forms, structured
        blocks — and the app renders them with its own design system. A plugin
        page is indistinguishable from a built-in one, because it is built
        from the same parts. Plugin authors do zero design work; the app stays
        one calm surface.
      </p>
      <p>
        And you stay in charge of the furniture: plugins contribute
        capabilities, but Settings → Menus decides which buttons appear where,
        in what order. New plugin actions arrive in the overflow menu, not in
        your face.
      </p>

      <h2>Honest about trust</h2>
      <p>
        The trust model is Obsidian's, stated plainly: plugins run inside the
        app, and installing one is trusting its author. Manifests declare
        permissions — network, reading data, AI, clipboard — and the API
        enforces them, which catches accidents, not malice. So the app shows
        you every permission in plain language before a single file is
        copied, and the marketplace reviews every submission in the open,
        readable source required. No dark corners, no "it's sandboxed"
        theater.
      </p>

      <h2>Start here</h2>
      <p>
        The <Link to="/docs/plugins/api">API reference</Link> documents the
        whole contract, and the{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          marketplace repository
        </a>{" "}
        has a TypeScript template plus the official plugins as working
        examples. Write one, and when it is good,{" "}
        <Link to="/docs/plugins/publishing">send it in</Link> — the
        marketplace tab in Settings is waiting for its first community
        plugins.
      </p>
    </BlogPost>
  ),
});
