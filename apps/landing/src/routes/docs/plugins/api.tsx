import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../lib/site";

export const Route = createFileRoute("/docs/plugins/api")({
  head: () => ({
    meta: [
      { title: "Plugin API reference — ReadAware Docs" },
      {
        name: "description",
        content:
          "The ReadAware plugin authoring contract: manifest, lifecycle, domain-derived permissions, data APIs, contributions, views, and events.",
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
        A plugin is a folder holding a <code>manifest.json</code> and one
        JavaScript module. This page is the authoring contract; the same
        contract ships as a TypeScript declaration file
        (<code>types/plugin-api.d.ts</code>) in the{" "}
        <a href={MARKETPLACE_REPO_URL} target="_blank" rel="noopener noreferrer">
          marketplace repository
        </a>
        , so editors autocomplete everything below.
      </p>

      <h2>Anatomy</h2>
      <pre>
        <code>{`my-plugin/
  manifest.json
  main.js        # one self-contained ES module`}</code>
      </pre>
      <p>
        <code>main.js</code> default-exports a lifecycle object. Everything a
        plugin can reach comes through the context handed to{" "}
        <code>activate</code>; every <code>register*</code> and{" "}
        <code>on</code> call returns a disposable that the app reclaims when
        the plugin is disabled or uninstalled, so <code>deactivate</code> only
        needs to release the plugin's own external resources.
      </p>
      <pre>
        <code>{`export default {
  activate(ctx) {
    // register contributions via ctx
  },
  deactivate() {
    // optional: close sockets, flush queues
  },
};`}</code>
      </pre>
      <p>
        Enabling and disabling take effect immediately — no app restart. Write
        in TypeScript if you like (recommended; see{" "}
        <Link to="/docs/plugins/publishing">Publishing</Link>) — what the app
        loads is always the built <code>main.js</code>.
      </p>

      <h2>manifest.json</h2>
      <pre>
        <code>{`{
  "id": "anki-sync",
  "name": "Anki Sync",
  "version": "0.1.0",
  "minAppVersion": "0.3.0",
  "description": "Send looked-up words to Anki.",
  "author": "you",
  "permissions": ["service:network", "annotations:read"],
  "main": "main.js"
}`}</code>
      </pre>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>id</code>
              </td>
              <td>
                Lowercase letters, digits, hyphens (max 64). Must equal the
                folder name; namespaces the plugin's storage and tools.
              </td>
            </tr>
            <tr>
              <td>
                <code>name</code>, <code>version</code>
              </td>
              <td>Shown in Settings → Plugins and the marketplace.</td>
            </tr>
            <tr>
              <td>
                <code>minAppVersion</code>
              </td>
              <td>
                Lowest app version the plugin supports. This contract requires{" "}
                <code>0.3.0</code> or newer.
              </td>
            </tr>
            <tr>
              <td>
                <code>permissions</code>
              </td>
              <td>
                What the plugin uses (table below). Shown to the user before
                installation.
              </td>
            </tr>
            <tr>
              <td>
                <code>main</code>
              </td>
              <td>
                Entry module relative to the folder; defaults to{" "}
                <code>main.js</code>.
              </td>
            </tr>
            <tr>
              <td>
                <code>settings</code>
              </td>
              <td>
                Optional declarative settings form (same field shapes as form
                views). The app renders it in the plugin panel and persists the
                values as one object under the storage key{" "}
                <code>settings</code>.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>The domain model</h2>
      <p>
        The data surface is derived from the app's domain model rather than
        authored beside it. Each domain — <code>books</code>,{" "}
        <code>collections</code>, <code>annotations</code>,{" "}
        <code>reading</code>, <code>conversations</code> — is a namespace on{" "}
        <code>ctx</code>{" "}
        exposing three things:
      </p>
      <ul>
        <li>
          <strong>reads</strong> — the domain's read models (what the app's own
          surfaces render);
        </li>
        <li>
          <strong>writes</strong> — commands under <code>.write</code> that
          mirror exactly the domain's event verbs and go through the app's own
          event-sourced write path, stamped{" "}
          <code>plugin:&lt;id&gt;</code> in the event log so every plugin
          write is attributable;
        </li>
        <li>
          <strong>subscriptions</strong> — <code>.on(event, handler)</code>{" "}
          over the domain's events under their canonical names (
          <code>book.starred</code>, <code>highlight.created</code>, …) — the
          same vocabulary the app itself records.
        </li>
      </ul>
      <p>
        Permissions follow the same shape: <code>&lt;domain&gt;:read</code> /{" "}
        <code>&lt;domain&gt;:write</code>, and within a domain{" "}
        <strong>write implies read</strong>. Device-local state (view
        preferences, reader appearance, sync internals) and free-form
        rendering are deliberately not plugin surface — UI goes through the
        declarative views below.
      </p>

      <h2>Permissions</h2>
      <p>
        Capability groups on <code>ctx</code> are simply absent unless their
        permission is declared — API-level gating against accidental overreach.
        Namespaced storage, UI contributions, session events, and reader
        navigation are not permissions; every plugin has them.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Permission</th>
              <th>Grants</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>books:read</code>
              </td>
              <td>
                <code>ctx.books</code> — the shelf's books, a book's table of
                contents and chapter text.
              </td>
            </tr>
            <tr>
              <td>
                <code>books:write</code>
              </td>
              <td>
                <code>ctx.books.write</code> — import files, edit metadata,
                star, remove; content providers and virtual books.
              </td>
            </tr>
            <tr>
              <td>
                <code>collections:read</code> / <code>collections:write</code>
              </td>
              <td>
                <code>ctx.collections</code> — the shelf's user-defined groups:
                list and membership; create, rename, remove, assign books.
              </td>
            </tr>
            <tr>
              <td>
                <code>annotations:read</code> / <code>annotations:write</code>
              </td>
              <td>
                <code>ctx.annotations</code> — highlights, notes, and asked
                questions; create, recolor, edit, and remove highlights and
                notes (asks are agent-written, read-only).
              </td>
            </tr>
            <tr>
              <td>
                <code>reading:read</code>
              </td>
              <td>
                <code>ctx.reading</code> — positions, statuses, and reading
                time. Read-only by design: its events are recorded facts of
                reader activity, not user commands.
              </td>
            </tr>
            <tr>
              <td>
                <code>conversations:read</code>
              </td>
              <td>
                <code>ctx.conversations</code> — per-book AI threads and global
                threads (read-only).
              </td>
            </tr>
            <tr>
              <td>
                <code>agent:tools</code>
              </td>
              <td>
                <code>ctx.agent.registerTool</code> — tools for the reading
                assistant.
              </td>
            </tr>
            <tr>
              <td>
                <code>service:network</code>
              </td>
              <td>
                <code>ctx.network.fetch</code> — outbound HTTP.
              </td>
            </tr>
            <tr>
              <td>
                <code>service:llm</code>
              </td>
              <td>
                <code>ctx.llm.ask</code> — one-shot model calls on the user's
                configured account. No thread, no memory, no tools.
              </td>
            </tr>
            <tr>
              <td>
                <code>service:dictionary</code>
              </td>
              <td>
                <code>ctx.dictionary.lookUp</code> — the app's dictionary
                (shares its cache and target-language preference with the
                reader; uses the user's AI). Pass <code>language</code> for an
                explicit target, or use <code>getLanguage</code> /{" "}
                <code>setLanguage</code> for the shared preference.
              </td>
            </tr>
            <tr>
              <td>
                <code>service:clipboard</code>
              </td>
              <td>
                <code>ctx.clipboard.writeText</code>.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Contributions</h2>

      <h3>Selection actions</h3>
      <p>
        Entries in the reader's selection and annotation menus. The handler
        receives the selected text, its CFI range, the chapter, and the book.
        Inside the reader an action either runs silently (return a toast) or
        opens a dialog (return a view) — those are the only two outcomes.
        Declare <code>presentation: "dialog"</code> when the handler is async:
        the host opens its loading shell immediately and fills the same request
        when <code>run</code> resolves.
      </p>
      <pre>
        <code>{`ctx.ui.registerSelectionAction({
  id: "save-quote",
  title: "Save quote",
  icon: "quotes",
  presentation: "dialog",
  run: (input) => {
    // input: { text, cfiRange, chapterHref, book, source }
    return { toast: "Quote saved." };
  },
});`}</code>
      </pre>

      <h3>Header actions</h3>
      <p>
        An icon button on a top bar. On the reader surface the view opens as an
        anchored popover; on the shelf it opens as a popover or a full page,
        per <code>presentation</code>. The reader never allows full-page
        interruptions.
      </p>
      <pre>
        <code>{`ctx.ui.registerHeaderAction({
  id: "reading-report",
  title: "Reading report",
  icon: "chart-line-up",
  surface: "shelf",
  presentation: "page",
  view: async () => ({
    kind: "markdown",
    title: "This week",
    markdown: "You read **4h 12m** across 3 books.",
  }),
});`}</code>
      </pre>

      <h3>Commands</h3>
      <p>
        A command-palette entry. All plugin actions also appear in the palette
        automatically; explicit commands are for actions with no button.
      </p>
      <pre>
        <code>{`ctx.ui.registerCommand({
  id: "sync-now",
  title: "Anki Sync: sync now",
  run: async () => ({ toast: "Synced." }),
});`}</code>
      </pre>

      <h3>Agent tools</h3>
      <p>
        Tools the reading assistant may call during chat (requires{" "}
        <code>agent:tools</code>). <code>parameters</code> is plain JSON
        Schema for the arguments object; omit it for a no-argument tool. Tools
        are namespaced <code>plugin_&lt;pluginId&gt;_&lt;name&gt;</code> before
        they reach the model, and calls are visible to the user as tool steps
        in the chat.
      </p>
      <pre>
        <code>{`ctx.agent?.registerTool({
  name: "search_deck",
  label: "Searching your Anki deck",
  description: "Search the user's Anki collection for a term.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  execute: async ({ query }) => {
    const res = await ctx.network.fetch("http://127.0.0.1:8765", {
      method: "POST",
      body: JSON.stringify({ action: "findNotes", query }),
    });
    return res.json();
  },
});`}</code>
      </pre>

      <h2>Views</h2>
      <p>
        Plugins declare a tree of host components; the app renders every visual
        primitive and control. Plugins never provide JSX, HTML, CSS, or classes.
      </p>
      <ul>
        <li>
          <code>markdown</code> — a markdown string, typeset by the app.
        </li>
        <li>
          <code>list</code> — searchable host lists with fixed debounce,
          keywords, accessories, and empty states. <code>timeline</code> adds
          Today / This week / This month / All filters and local-date groups;
          an item can use <code>presentation: "dialog"</code> to show its
          returned view over the list instead of pushing a child page. List-level{" "}
          <code>actions</code> are host-rendered icon buttons; timelines place
          them at the far right of the tab row.
        </li>
        <li>
          <code>form</code> — text, textarea, number, select, choice, checkbox,
          and toggle controls from the ReadAware component library, plus{" "}
          <code>onSubmit</code>.
        </li>
        <li>
          <code>detail</code> — Raycast-style primary content, metadata, and
          host-rendered controls and actions. Semantic select controls stay by
          the content heading; dialogs keep provenance, dates, and tags in a
          quiet line beneath it, while actions sit beside the host Close button
          in a fixed footer.
        </li>
        <li>
          <code>blocks</code> — host typography, markdown, dictionary content,
          metadata, quotes, actions, metrics, progress, tags, alerts, sections,
          groups, and responsive <code>columns</code>. Columns expose only
          bounded weight, spacing, minimum-width presets, and semantic
          alignment. Exact CSS and wrapping stay inside the design system;
          declarations are runtime-validated and nesting is capped.
        </li>
      </ul>
      <p>
        Handlers (<code>run</code>, <code>onSelect</code>,{" "}
        <code>onSubmit</code>) all return the same result shape:
      </p>
      <ul>
        <li>
          nothing — the surface stays as it is;
        </li>
        <li>
          <code>{"{ toast: \"…\" }"}</code> — a transient notice;
        </li>
        <li>
          <code>{"{ view }"}</code> — open, or push onto, the surface;
        </li>
        <li>
          <code>{'{ view, navigation: "replace" | "reset" }'}</code> —
          replace the current view, or return to a new root view;
        </li>
        <li>
          <code>{"{ close: true }"}</code> — dismiss the surface (composable
          with <code>toast</code>);
        </li>
        <li>
          <code>{"{ fieldErrors }"}</code> — from a form submit: stay on the
          form and show errors under the fields.
        </li>
      </ul>
      <p>
        Async work is a non-event: return a promise and the app shows the
        loading state. Icons are chosen by name from the app's curated Phosphor
        set — no custom SVG.
      </p>

      <h2>Domain data</h2>
      <p>
        Each granted domain namespace offers reads, canonical event
        subscriptions, and (with the write permission) commands. In brief:
      </p>
      <ul>
        <li>
          <code>ctx.books</code> — <code>list()</code>, <code>get(id)</code>,{" "}
          <code>getToc(id)</code>, <code>getChapterText(id, index)</code>;
          write: <code>import</code>, <code>editMetadata</code>,{" "}
          <code>setStarred</code>, <code>remove</code>, plus content providers
          (below).
        </li>
        <li>
          <code>ctx.collections</code> — <code>list()</code>,{" "}
          <code>booksIn(id)</code>; write: <code>create</code>,{" "}
          <code>rename</code>, <code>remove</code>,{" "}
          <code>assignBooks(bookIds, collectionId | null)</code>.
        </li>
        <li>
          <code>ctx.annotations</code> —{" "}
          <code>list({"{ bookId?, kind?, query? }"})</code> returns a
          discriminated union of highlights, notes, and asks; write:{" "}
          <code>createHighlight</code>, <code>recolorHighlight</code>,{" "}
          <code>removeHighlight</code>, <code>createNote</code>,{" "}
          <code>updateNote</code>, <code>removeNote</code>.
        </li>
        <li>
          <code>ctx.reading</code> — <code>getState(bookId)</code>,{" "}
          <code>listStates()</code>, <code>getTime(bookId)</code>.
        </li>
        <li>
          <code>ctx.conversations</code> — <code>getBookThread(bookId)</code>,{" "}
          <code>listThreads()</code>, <code>getThread(id)</code>; subscribe via{" "}
          <code>on</code> (<code>aiConversation.started</code>,{" "}
          <code>aiMessage.appended</code>, <code>aiMessage.removed</code>,{" "}
          <code>aiConversation.cleared</code>).
        </li>
      </ul>

      <h2>Events</h2>
      <p>
        Two classes, deliberately separate. <strong>Domain events</strong> are
        the facts the app records; subscribe per domain, under canonical names,
        with the domain's read permission. Each delivery is{" "}
        <code>{"{ type, payload, createdAt, origin }"}</code> — origin says
        which software actor produced the fact (<code>user</code>,{" "}
        <code>agent</code>, <code>system</code>, or{" "}
        <code>plugin:&lt;id&gt;</code>).
      </p>
      <pre>
        <code>{`ctx.annotations?.on("highlight.created", ({ payload, origin }) => {
  // payload: { highlightId, bookId, text, color?, … }
});
ctx.books?.on("book.removed", ({ payload }) => { /* { bookId } */ });
`}</code>
      </pre>
      <p>
        <strong>Session facts</strong> describe what is on screen right now.
        They never enter the event log and need no permission:{" "}
        <code>ctx.session.on(event, handler)</code>.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Session event</th>
              <th>Payload</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>book-opened</code>
              </td>
              <td>
                <code>{"{ book: { id, title, author? } }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>book-closed</code>
              </td>
              <td>
                <code>{"{ bookId }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>chapter-changed</code>
              </td>
              <td>
                <code>{"{ bookId, chapterHref }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>reading-progress</code>
              </td>
              <td>
                <code>{"{ bookId, fraction }"}</code> — fires on page turns,
                fraction 0..1
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Content providers and virtual books</h2>
      <p>
        With <code>books:write</code>, a plugin can put real books on the
        shelf. <code>import</code> takes a file's bytes. Content providers
        skip the file entirely: register a provider, add virtual books bound to
        it, and serve HTML sections when the book is opened. The reader
        paginates, annotates, and tracks progress on them like any book — an
        RSS feed as a book is exactly this.
      </p>
      <pre>
        <code>{`ctx.books?.write?.registerContentProvider({
  id: "rss",
  async load(key) {
    const feed = await fetchFeed(key); // your code, via ctx.network.fetch
    return {
      title: feed.title,
      sections: feed.items.map((item) => ({
        title: item.title,
        html: item.contentHtml,
      })),
    };
  },
});

await ctx.books?.write?.addVirtualBook({
  providerId: "rss",
  key: "https://example.com/feed.xml",
  title: "Example Weekly",
});`}</code>
      </pre>

      <h2>Storage and settings</h2>
      <p>
        <code>ctx.storage</code> is a namespaced key-value store persisted with
        the app's local data — <code>get</code>, <code>set</code>,{" "}
        <code>remove</code>. If the manifest declares <code>settings</code>{" "}
        fields, the app renders the form and the values arrive at{" "}
        <code>ctx.storage.get("settings")</code> as one object.
      </p>
      <p>
        For structured data, <code>ctx.storage.collection(name)</code> opens a
        named document collection — <code>put</code> / <code>get</code> /{" "}
        <code>delete</code> / <code>list</code> over per-document records, with
        optional <code>bookId</code> / <code>anchor</code> provenance you can
        filter by. Provenance is an index, not ownership: documents survive
        the referenced book's deletion, and the collection's lifecycle belongs
        to the plugin (uninstall clears it). The built-in Dictionary plugin and
        its saved-word timeline are built entirely on this tier.
      </p>

      <h2>Ambient context</h2>
      <p>Always available, no permission needed:</p>
      <ul>
        <li>
          <code>ctx.manifest</code>, <code>ctx.appVersion</code>;
        </li>
        <li>
          <code>ctx.ui.showToast(message)</code>;
        </li>
        <li>
          <code>ctx.ui.exportFile({"{ filename, content, mimeType? }"})</code>{" "}
          opens the host save flow for generated CSV, JSON, Markdown, or other
          UTF-8 text;
        </li>
        <li>
          <code>ctx.session.on(…)</code> — the session facts above;
        </li>
        <li>
          <code>ctx.reader.openBook(bookId)</code> and{" "}
          <code>ctx.reader.goTo({"{ bookId?, cfi?, href? }"})</code> — navigate
          the reader (user-visible control, no data exposure).
        </li>
      </ul>

      <h2>Stability</h2>
      <p>
        This is contract v2, shipped in app 0.3.0 — a deliberate breaking
        rebuild that derived the whole surface from the domain model (v1
        manifests fail installation with a readable error). From here the API
        grows additively: new domains, new event names, new block kinds.
        Breaking changes to what is documented here are treated as bugs.
        Declare <code>minAppVersion</code> for anything that depends on a
        recent addition.
      </p>
    </article>
  );
}
