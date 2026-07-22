import { Link, createFileRoute } from "@tanstack/react-router";
import { MARKETPLACE_REPO_URL } from "../../../lib/site";

export const Route = createFileRoute("/docs/plugins/api")({
  head: () => ({
    meta: [
      { title: "Plugin API reference — ReadAware Docs" },
      {
        name: "description",
        content:
          "The ReadAware plugin authoring contract: manifest, lifecycle, permissions, contributions, views, and events.",
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
        <code>activate</code>; every <code>register*</code> call returns a
        disposable that the app reclaims when the plugin is disabled or
        uninstalled, so <code>deactivate</code> only needs to release the
        plugin's own external resources.
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
  "minAppVersion": "0.2.0",
  "description": "Send looked-up words to Anki.",
  "author": "you",
  "permissions": ["network", "reading-data"],
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
              <td>Lowest app version the plugin supports.</td>
            </tr>
            <tr>
              <td>
                <code>permissions</code>
              </td>
              <td>
                Capability domains the plugin uses (table below). Shown to the
                user before installation.
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

      <h2>Permissions</h2>
      <p>
        Capability groups on <code>ctx</code> are simply absent unless their
        permission is declared — API-level gating against accidental overreach.
        Namespaced storage is not a permission; every plugin has it.
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
                <code>reading-data</code>
              </td>
              <td>
                <code>ctx.reading</code> — books (read), annotations
                (create/delete), chapter text, and the built-in vocabulary
                notebook. Also required for <code>annotation-*</code> events.
              </td>
            </tr>
            <tr>
              <td>
                <code>library-write</code>
              </td>
              <td>
                <code>ctx.library</code> — import book files and provide
                virtual books (content providers).
              </td>
            </tr>
            <tr>
              <td>
                <code>network</code>
              </td>
              <td>
                <code>ctx.fetch</code> — outbound HTTP.
              </td>
            </tr>
            <tr>
              <td>
                <code>ai</code>
              </td>
              <td>
                <code>ctx.ai.registerTool</code> — tools for the reading
                assistant.
              </td>
            </tr>
            <tr>
              <td>
                <code>dictionary</code>
              </td>
              <td>
                <code>ctx.dictionary.lookUp</code> — the app's dictionary
                (shares its cache with the reader; uses the user's AI).
              </td>
            </tr>
            <tr>
              <td>
                <code>llm</code>
              </td>
              <td>
                <code>ctx.llm.ask</code> — one-shot model calls on the user's
                configured account. No thread, no memory, no tools.
              </td>
            </tr>
            <tr>
              <td>
                <code>clipboard</code>
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
      </p>
      <pre>
        <code>{`ctx.ui.registerSelectionAction({
  id: "save-quote",
  title: "Save quote",
  icon: "quotes",
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
        Tools the reading assistant may call during chat (requires the{" "}
        <code>ai</code> permission). <code>parameters</code> is plain JSON
        Schema for the arguments object; omit it for a no-argument tool. Tools
        are namespaced <code>plugin_&lt;pluginId&gt;_&lt;name&gt;</code> before
        they reach the model, and calls are visible to the user as tool steps
        in the chat.
      </p>
      <pre>
        <code>{`ctx.ai?.registerTool({
  name: "search_deck",
  label: "Searching your Anki deck",
  description: "Search the user's Anki collection for a term.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  execute: async ({ query }) => {
    const res = await ctx.fetch("http://127.0.0.1:8765", {
      method: "POST",
      body: JSON.stringify({ action: "findNotes", query }),
    });
    return res.json();
  },
});`}</code>
      </pre>

      <h2>Views</h2>
      <p>
        Plugins describe interfaces declaratively; the app renders them. Four
        kinds:
      </p>
      <ul>
        <li>
          <code>markdown</code> — a markdown string, typeset by the app.
        </li>
        <li>
          <code>list</code> — items{" "}
          <code>{"{ id, title, subtitle?, icon?, onSelect? }"}</code>;{" "}
          <code>onSelect</code> may return another view to drill down.
        </li>
        <li>
          <code>form</code> — fields (text, textarea, number, select, toggle)
          plus <code>onSubmit</code>, which receives the values and may return
          a result view or field errors.
        </li>
        <li>
          <code>blocks</code> — an ordered sequence of blocks: markdown,
          heading, dictionary entry, key-value rows, quote, action buttons,
          divider, or nested list/form. This is the growth path for richer
          pages.
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

      <h2>Events</h2>
      <p>
        <code>ctx.events.on(event, handler)</code> returns a disposable.{" "}
        <code>annotation-*</code> events require the <code>reading-data</code>{" "}
        permission; the rest are ambient.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Event</th>
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
            <tr>
              <td>
                <code>book-removed</code>
              </td>
              <td>
                <code>{"{ bookId }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>annotation-created</code>
              </td>
              <td>
                <code>{"{ annotation }"}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>annotation-deleted</code>
              </td>
              <td>
                <code>{"{ id }"}</code>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Reading data</h2>
      <p>
        With <code>reading-data</code>, <code>ctx.reading</code> exposes the
        user's reading trace:
      </p>
      <ul>
        <li>
          <code>listBooks()</code>, <code>listAnnotations(filter?)</code>;
        </li>
        <li>
          <code>createHighlight(…)</code>, <code>createNote(…)</code>,{" "}
          <code>updateNote(…)</code>, <code>recolorHighlight(…)</code>,{" "}
          <code>deleteAnnotation(id)</code>;
        </li>
        <li>
          <code>getToc(bookId)</code> and{" "}
          <code>getChapterText(bookId, index)</code> — a book's chapter list
          and plain text (extraction runs on demand);
        </li>
        <li>
          <code>vocabulary.list / add / remove</code> — the same notebook the
          reader's dictionary saves into.
        </li>
      </ul>

      <h2>Library and virtual books</h2>
      <p>
        With <code>library-write</code>, a plugin can put real books on the
        shelf. <code>importBook</code> takes a file's bytes. Content providers
        skip the file entirely: register a provider, add virtual books bound to
        it, and serve HTML sections when the book is opened. The reader
        paginates, annotates, and tracks progress on them like any book — an
        RSS feed as a book is exactly this.
      </p>
      <pre>
        <code>{`ctx.library?.registerContentProvider({
  id: "rss",
  async load(key) {
    const feed = await fetchFeed(key); // your code, via ctx.fetch
    return {
      title: feed.title,
      sections: feed.items.map((item) => ({
        title: item.title,
        html: item.contentHtml,
      })),
    };
  },
});

await ctx.library?.addVirtualBook({
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
          <code>ctx.reader.openBook(bookId)</code> and{" "}
          <code>ctx.reader.goTo({"{ bookId?, cfi?, href? }"})</code> — navigate
          the reader (user-visible control, no data exposure).
        </li>
      </ul>

      <h2>Stability</h2>
      <p>
        The API surface is deliberately small and grows additively — new block
        kinds, new events, new capability groups. Breaking changes to what is
        documented here are treated as bugs. Declare{" "}
        <code>minAppVersion</code> for anything that depends on a recent
        addition.
      </p>
    </article>
  );
}
