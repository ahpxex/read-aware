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
                Optional declarative settings (same field shapes as form
                views, plus <code>secret</code>). The app renders them as the
                plugin's own section in Settings and persists the values as
                one object under the storage key <code>settings</code> — see{" "}
                <a href="#storage-and-settings">Storage and settings</a>.
              </td>
            </tr>
            <tr>
              <td>
                <code>schedules</code>
              </td>
              <td>
                Optional recurring tasks, declared so users see them before
                installing — see <a href="#scheduled-work">Scheduled work</a>.
              </td>
            </tr>
            <tr>
              <td>
                <code>themes</code>, <code>fonts</code>
              </td>
              <td>
                Optional declarative themes and bundled fonts (requires{" "}
                <code>ui:themes</code>) — see{" "}
                <a href="#themes-and-bundled-fonts">
                  Themes and bundled fonts
                </a>
                .
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>The domain model</h2>
      <p>
        The data surface is derived from the app's domain model rather than
        authored beside it. Each domain — <code>shelf</code> (the whole of
        library management: books, collections, reading stats),{" "}
        <code>annotations</code>, <code>conversations</code> — is a namespace
        on <code>ctx</code> exposing three things:
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
                <code>shelf:read</code>
              </td>
              <td>
                <code>ctx.shelf</code> — books (incl. a book's table of
                contents and chapter text), collections and membership, and
                reading stats (<code>stats.forBook</code> /{" "}
                <code>stats.list</code> / <code>stats.overview</code> — stats
                have no write face: their events are recorded facts of reader
                activity, not user commands).
              </td>
            </tr>
            <tr>
              <td>
                <code>shelf:write</code>
              </td>
              <td>
                <code>ctx.shelf.books.write</code> — import files, edit
                metadata, star, mark finished, remove; content providers and
                virtual books. <code>ctx.shelf.collections.write</code> —
                create, rename, remove, assign books.
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
                <code>conversations:read</code>
              </td>
              <td>
                <code>ctx.conversations</code> — per-book AI threads and global
                threads (read-only).
              </td>
            </tr>
            <tr>
              <td>
                <code>ui:themes</code>
              </td>
              <td>
                The declarative <code>themes</code> / <code>fonts</code>{" "}
                manifest fields (below) — app and reader themes with bundled
                fonts. The only UI contribution behind a permission: it has
                visual authority over the whole app, so the install consent
                must surface it.
              </td>
            </tr>
            <tr>
              <td>
                <code>ui:appearance</code>
              </td>
              <td>
                <code>ctx.appearance</code> — list everything both appearance
                surfaces offer, read the current appearance, and switch the app
                theme or the reader page color. Separate from{" "}
                <code>ui:themes</code> on purpose: offering a theme is passive,
                switching one is not.
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
                <code>ctx.network.fetch</code> — outbound HTTP through the
                app's native client (no CORS constraints).
              </td>
            </tr>
            <tr>
              <td>
                <code>service:llm</code>
              </td>
              <td>
                <code>ctx.llm.ask</code> — one-shot model calls on the user's
                configured account. No thread, no memory, no tools; supports
                structured JSON output via <code>schema</code> and streaming
                via <code>onText</code>.
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
      <p>
        (<code>reader:modes</code> — host-rendered guided reading modes — is
        currently reserved for the bundled first-party plugins while that
        privileged contract settles.)
      </p>

      <h2>Contributions</h2>

      <h3>Selection actions</h3>
      <p>
        Entries in the reader's selection and annotation menus. The handler
        receives the selected text, its CFI range, the chapter, and the book.
        When available, <code>context</code> contains the surrounding passage.
        Inside the reader an action either runs silently (return a toast) or
        opens a dialog (return a view) — those are the only two outcomes.
        Declare <code>presentation: "dialog"</code> when the handler is async:
        the host opens its loading shell immediately and fills the same request
        when <code>run</code> resolves.
        A dictionary-style action may declare <code>role: "lookup"</code>; the
        host then routes its existing Look up keyboard command to that plugin
        action instead of maintaining a second built-in lookup path.
      </p>
      <pre>
        <code>{`ctx.ui.registerSelectionAction({
  id: "save-quote",
  title: "Save quote",
  icon: "quotes",
  presentation: "dialog",
  run: (input) => {
    // input: { text, context?, cfiRange, chapterHref, book, source }
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

      <h3>Voice providers</h3>
      <p>
        <code>ctx.audio.registerVoiceProvider</code> plugs a text-to-speech
        engine into the reader's read-aloud. The plugin only turns text into
        encoded audio bytes (mp3/wav — anything the webview decodes); the app
        owns playback, sentence pacing, prefetch, and the follow-along
        highlight. Registration needs no permission of its own — whatever the
        provider needs to synthesize (network, keys) is already gated by its
        other permissions.
      </p>
      <pre>
        <code>{`ctx.audio.registerVoiceProvider({
  id: "voices",
  label: "My TTS",
  listVoices: () => [{ id: "default", label: "My TTS · warm" }],
  synthesize: async ({ text, voiceId }) => {
    const res = await ctx.network.fetch("http://127.0.0.1:8880/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: text, response_format: "mp3" }),
    });
    return res.arrayBuffer();
  },
});`}</code>
      </pre>
      <p>
        A registered voice is adopted automatically — the user enabling your
        plugin is the opt-in, there is no separate host-side picker — and a
        failed synthesis call falls back to the system voice for that
        sentence, so reading degrades instead of falling silent. Voices are
        re-listed whenever the plugin's settings change.
      </p>

      <h3 id="scheduled-work">Scheduled work</h3>
      <p>
        The manifest declares recurring tasks; <code>activate</code> binds the
        work. The app runs each schedule AT LEAST every{" "}
        <code>everyMinutes</code> (floored at 15) while it is open, with a
        catch-up run shortly after launch when overdue — never at exact times,
        and never while the app is closed. Overlapping runs of one schedule
        are skipped; a failed run just waits for the next cadence.
      </p>
      <pre>
        <code>{`// manifest.json
"schedules": [{ "id": "refresh", "label": "Refresh feeds", "everyMinutes": 60 }]

// main.js
ctx.schedule.on("refresh", async () => {
  // fetch, reconcile, write through the domain APIs
});`}</code>
      </pre>

      <h3 id="themes-and-bundled-fonts">Themes and bundled fonts</h3>
      <p>
        With <code>ui:themes</code>, the manifest may declare themes for two
        independent mount points — the app chrome and the book page — plus
        font files that ship inside the plugin folder. This contribution is
        pure data: the app validates every value and generates all CSS itself,
        and nothing applies until the user picks the theme in Settings →
        Appearance or the reader's page-color control. A theme-only plugin's{" "}
        <code>main.js</code> is just{" "}
        <code>{"export default { activate() {} }"}</code>.
      </p>
      <pre>
        <code>{`{
  "permissions": ["ui:themes"],
  "fonts": [
    {
      "id": "my-serif",
      "family": "My Serif",
      "kind": "serif",
      "files": [{ "path": "assets/my-serif-400.woff2", "weight": 400 }]
    }
  ],
  "themes": [
    {
      "id": "dusk",
      "name": { "default": "Dusk", "translations": { "zh-Hans": "暮色" } },
      "polarity": "dark",
      "app": { "paper": "#14171e", "fg": "#e3e6ec" },
      "reader": {
        "palette": {
          "bg": "#161a22", "text": "#ccd2dd",
          "selection": "rgba(154, 162, 177, 0.28)",
          "rule": "rgba(204, 210, 221, 0.18)",
          "faint": "rgba(204, 210, 221, 0.07)",
          "muted": "rgba(204, 210, 221, 0.55)"
        },
        "typography": { "fontFamily": "plugin:my-serif", "fontSize": "large" }
      }
    }
  ]
}`}</code>
      </pre>
      <ul>
        <li>
          <code>polarity</code> — whether the theme reads as light or dark.
          Drives <code>color-scheme</code>, the polarity defaults for app
          tokens the theme leaves unset, and how the reader's Auto page color
          resolves while the theme is active.
        </li>
        <li>
          <code>app</code> — overrides on the app's fixed token vocabulary
          (canvas, text tiers, surfaces, fills, borders — see{" "}
          <code>PluginAppThemeTokens</code> in the typings). Unset tokens keep
          the polarity's own values.
        </li>
        <li>
          <code>reader</code> — the same six-color palette the built-in page
          colors use (all six required), plus an optional typography preset
          applied once when the user selects the theme; the user can adjust
          everything afterwards.
        </li>
        <li>
          <code>fonts</code> — <code>.woff2</code>/<code>.woff</code>/
          <code>.ttf</code>/<code>.otf</code> faces served straight from the
          plugin folder; each appears in the reader's font picker while the
          plugin is enabled. A theme references its own fonts as{" "}
          <code>plugin:&lt;fontId&gt;</code>. Marketplace plugins must list
          font files in the registry entry's <code>files</code>.
        </li>
        <li>
          Colors are validated against strict grammars — plain hex or{" "}
          <code>rgb()</code>/<code>rgba()</code>/<code>hsl()</code>/
          <code>hsla()</code>; keywords, <code>var()</code>, and{" "}
          <code>url()</code> are rejected.
        </li>
      </ul>

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
          <code>form</code> — text, textarea, number, time, select, choice, checkbox,
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
          <code>ctx.shelf.books</code> — <code>list()</code>,{" "}
          <code>get(id)</code>, <code>getToc(id)</code>,{" "}
          <code>getChapterText(id, index)</code>; write: <code>import</code>,{" "}
          <code>editMetadata</code>, <code>setStarred</code>,{" "}
          <code>setFinished</code>, <code>remove</code>, plus content
          providers (below).
        </li>
        <li>
          <code>ctx.shelf.collections</code> — <code>list()</code>,{" "}
          <code>booksIn(id)</code>; write: <code>create</code>,{" "}
          <code>rename</code>, <code>remove</code>,{" "}
          <code>assignBooks(bookIds, collectionId | null)</code>.
        </li>
        <li>
          <code>ctx.shelf.stats</code> — <code>forBook(bookId)</code>,{" "}
          <code>list()</code>, <code>overview()</code> (positions, statuses,
          and active reading time; read-only for every actor).
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
ctx.shelf?.on("book.removed", ({ payload }) => { /* { bookId } */ });
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
        With <code>shelf:write</code>, a plugin can put real books on the
        shelf. <code>import</code> takes a file's bytes. Content providers
        skip the file entirely: register a provider, add virtual books bound to
        it, and serve HTML sections when the book is opened. The reader
        paginates, annotates, and tracks progress on them like any book — an
        RSS feed as a book is exactly this.
      </p>
      <pre>
        <code>{`ctx.shelf?.books.write?.registerContentProvider({
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

await ctx.shelf?.books.write?.addVirtualBook({
  providerId: "rss",
  key: "https://example.com/feed.xml",
  title: "Example Weekly",
});`}</code>
      </pre>

      <h2 id="storage-and-settings">Storage and settings</h2>
      <p>
        <code>ctx.storage</code> is a namespaced key-value store persisted with
        the app's local data — <code>get</code>, <code>set</code>,{" "}
        <code>remove</code>. If the manifest declares <code>settings</code>{" "}
        fields, the app renders them as the plugin's own section in Settings
        and the values arrive at <code>ctx.storage.get("settings")</code> as
        one object. The reading assistant can view and change these settings
        too (fields marked <code>agentHidden</code> stay out of its sight).
        Three field capabilities go beyond a plain form:
      </p>
      <ul>
        <li>
          <code>visibleWhen: {"{ field, equals }"}</code> shows a field only
          while another field holds one of the given values. Hidden fields
          keep their stored values — one settings object can carry a value
          set per variant (the TTS plugin keeps one voice per provider this
          way).
        </li>
        <li>
          A <code>select</code> with <code>dynamicOptions: true</code>{" "}
          resolves its options at runtime: bind the source in{" "}
          <code>activate</code> with{" "}
          <code>ctx.settings.provideOptions(fieldId, async (values) =&gt;
          [...])</code>. When the source yields nothing (no credentials yet,
          endpoint unreachable) the field falls back to free text input —
          listing is a convenience, never a gate.
        </li>
        <li>
          <code>kind: "secret"</code> declares a credential: the app renders a
          password input writing to the encrypted secret store — the field id
          IS the <code>ctx.secrets</code> key your code reads back — never to
          plain settings, and never into the assistant's catalog. The stored
          value is never echoed; the field shows a configured state and a
          clear affordance.
        </li>
      </ul>
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
          <code>ctx.manifest</code>, <code>ctx.appVersion</code>,{" "}
          <code>ctx.locale</code> (the app UI's current BCP-47 locale — read
          it at use time, it tracks the language setting live);
        </li>
        <li>
          <code>ctx.ui.showToast(message)</code>;
        </li>
        <li>
          <code>ctx.ui.exportFile({"{ filename, content, mimeType? }"})</code>{" "}
          opens the host save flow for generated text (CSV, JSON, Markdown) or
          binary bytes;
        </li>
        <li>
          <code>ctx.secrets</code> — encrypted credential storage, namespaced
          per plugin (API tokens and similar); lives outside SQLite and
          backups and survives uninstall;
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
        grows additively: new domains, new event names, new block kinds —
        declarative themes (<code>ui:themes</code>) are the first such
        addition. Breaking changes to what is documented here are treated as
        bugs. Declare <code>minAppVersion</code> for anything that depends on
        a recent addition.
      </p>
    </article>
  );
}
