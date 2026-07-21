/**
 * @read-aware/plugin-types — the public plugin API contract.
 *
 * This package is the single source of truth for every type a plugin author
 * touches (docs/plugin-system.md). The app re-exports it (its surfaces build
 * on these shapes), and the marketplace repo's TypeScript template ships a
 * declaration copy of it so plugins get full typing with zero dependencies.
 *
 * Design contract: plugins contribute *declarative* capabilities (actions,
 * commands, agent tools) and describe any UI they open with the constrained
 * view vocabulary below (markdown / list / form). They never render JSX or
 * HTML; the app renders every view with its own design system, so plugin
 * surfaces always look native.
 */

/** Permission domains a manifest may declare (docs/plugin-system.md §4). */
export const PLUGIN_PERMISSIONS = [
  "reading-data",
  "library-write",
  "network",
  "ai",
  "dictionary",
  "llm",
  "clipboard",
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export type PluginManifest = {
  /** Directory name and namespace: lowercase, digits, hyphens. */
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  /** Lowest app version the plugin supports, e.g. "0.2.0". */
  minAppVersion?: string;
  permissions?: PluginPermission[];
  /** Entry module relative to the plugin folder. Defaults to "main.js". */
  main?: string;
  /**
   * Declarative settings: rendered by the app from the Plugins panel; values
   * persist as one object under the plugin's storage key `settings`
   * (read with `ctx.storage.get("settings")`).
   */
  settings?: PluginFormField[];
};

/** Returned by every `register*` call; disposing removes the contribution. */
export type PluginDisposable = { dispose: () => void };

// ─── View vocabulary ─────────────────────────────────────────────────────────

export type PluginMarkdownView = {
  kind: "markdown";
  title?: string;
  markdown: string;
};

export type PluginListItem = {
  id: string;
  title: string;
  subtitle?: string;
  /** Icon name from the curated Phosphor set. */
  icon?: string;
  /** Optional drill-down: return `{ view }` to push a detail view. */
  onSelect?: () => PluginViewResult | Promise<PluginViewResult>;
};

export type PluginListView = {
  kind: "list";
  title?: string;
  items: PluginListItem[];
  /** Shown when `items` is empty. */
  emptyText?: string;
};

export type PluginFormField =
  | { kind: "text"; id: string; label: string; value?: string; placeholder?: string }
  | { kind: "textarea"; id: string; label: string; value?: string; placeholder?: string; rows?: number }
  | { kind: "number"; id: string; label: string; value?: number; min?: number; max?: number; step?: number }
  | {
      kind: "select";
      id: string;
      label: string;
      value?: string;
      options: { value: string; label: string }[];
    }
  | { kind: "toggle"; id: string; label: string; value?: boolean };

export type PluginFormValues = Record<string, string | boolean | number>;

export type PluginFormView = {
  kind: "form";
  title?: string;
  fields: PluginFormField[];
  submitLabel?: string;
  onSubmit: (values: PluginFormValues) => PluginViewResult | Promise<PluginViewResult>;
};

/**
 * The compositional view: an ordered sequence of blocks. This is the growth
 * path of the vocabulary — richer surfaces come from new block kinds, not
 * from plugins drawing their own UI. The single-kind views above remain as
 * shorthands for one-block pages.
 */
export type PluginBlocksView = {
  kind: "blocks";
  title?: string;
  blocks: PluginBlock[];
};

export type PluginBlock =
  | { kind: "markdown"; markdown: string }
  /** A dictionary entry, rendered with the app's own dictionary UX. */
  | { kind: "dictionary"; entry: PluginDictionaryEntry }
  /** Label/value rows (provenance, metadata) in a quiet definition list. */
  | { kind: "keyValue"; rows: { label: string; value: string }[] }
  /** A quoted passage with an optional attribution line. */
  | { kind: "quote"; text: string; caption?: string }
  /** A row of buttons; each runs like any other contribution outcome. */
  | {
      kind: "actions";
      actions: {
        id: string;
        label: string;
        icon?: string;
        variant?: "solid" | "outline" | "ghost" | "danger";
        run: () => PluginViewResult | Promise<PluginViewResult>;
      }[];
    }
  | { kind: "divider" }
  | PluginListView
  | PluginFormView;

export type PluginView =
  | PluginMarkdownView
  | PluginListView
  | PluginFormView
  | PluginBlocksView;

/**
 * What an action / list-select / form-submit may produce:
 * - `undefined` / `null` — nothing happens (surface stays as is);
 * - `{ toast }` — a transient notice;
 * - `{ view }` — open (or push onto) the surface with this view;
 * - `{ close: true }` — dismiss the surface (composable with `toast`);
 * - `{ fieldErrors }` (from a form submit) — stay on the form and show the
 *   errors under their fields.
 */
export type PluginViewResult =
  | void
  | undefined
  | null
  | {
      toast?: string;
      view?: PluginView;
      close?: boolean;
      fieldErrors?: Record<string, string>;
    };

// ─── Contributions ───────────────────────────────────────────────────────────

/** Where a selection action was triggered from. */
export type SelectionActionSource = "selection" | "annotation" | "navigator";

export type SelectionActionInput = {
  text: string;
  /** CFI range of the selection/annotation, when the engine can anchor it. */
  cfiRange: string | null;
  chapterHref: string | null;
  book: { id: string; title: string; author?: string };
  source: SelectionActionSource;
};

/**
 * An entry in the reader's selection/annotation action menus. Runs silently
 * (`toast` feedback) or opens a Dialog (`view` result) — the only two outcomes
 * allowed inside the reader.
 */
export type PluginSelectionAction = {
  id: string;
  title: string;
  icon?: string;
  run: (input: SelectionActionInput) => PluginViewResult | Promise<PluginViewResult>;
};

export type PluginHeaderSurface = "shelf" | "reader";

export type HeaderActionInput = {
  /** Present on the reader surface: the open book. */
  book?: { id: string; title: string; author?: string };
};

/**
 * An icon button on a header bar. On the reader surface the view always opens
 * as an anchored Popup; on the shelf it opens as a Popup or a full Page,
 * per `presentation`.
 */
export type PluginHeaderAction = {
  id: string;
  title: string;
  icon?: string;
  surface: PluginHeaderSurface;
  /** Shelf only — the reader never allows full-page interruptions. */
  presentation?: "popup" | "page";
  view: (input: HeaderActionInput) => PluginView | Promise<PluginView>;
};

/** A command-palette entry. */
export type PluginCommand = {
  id: string;
  title: string;
  icon?: string;
  /** Extra text folded into palette matching. */
  keywords?: string;
  run: () => PluginViewResult | Promise<PluginViewResult>;
};

/**
 * A tool exposed to the reading agent. `parameters` is plain JSON Schema for
 * the arguments object; omit it for a no-argument tool. The registered tool is
 * namespaced `plugin_<pluginId>_<name>` before it reaches the model.
 */
export type PluginToolDefinition = {
  /** snake_case identifier, unique within the plugin. */
  name: string;
  /** Short human label shown in the chat's tool activity row. */
  label?: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => unknown | Promise<unknown>;
};

// ─── Events ──────────────────────────────────────────────────────────────────

/**
 * What a plugin can observe. Reading-data-bearing events (`annotation-*`)
 * require the `reading-data` permission; the rest are ambient.
 */
export type PluginEventMap = {
  "book-opened": { book: { id: string; title: string; author?: string } };
  "book-closed": { bookId: string };
  "chapter-changed": { bookId: string; chapterHref: string | null };
  /** Fires on page turns; fraction is 0..1. */
  "reading-progress": { bookId: string; fraction: number };
  "annotation-created": { annotation: PluginAnnotation };
  "annotation-deleted": { id: string };
};

export type PluginEventName = keyof PluginEventMap;

// ─── Context handed to activate() ────────────────────────────────────────────

export type PluginStorage = {
  get<T = unknown>(key: string): T | null;
  set(key: string, value: unknown): void;
  remove(key: string): void;
};

export type PluginBookOverview = {
  id: string;
  title: string;
  author?: string;
  progressFraction?: number;
  addedAt?: string;
  lastOpenedAt?: string;
};

export type PluginAnnotation = {
  id: string;
  bookId: string;
  kind: "highlight" | "note" | "ask";
  text: string;
  content?: string;
  chapter?: string;
  createdAt: string;
};

/**
 * Everything a plugin can reach. Capability groups guarded by a permission
 * domain are absent unless the manifest declares that permission — API-level
 * gating against accidental overreach (the trust boundary is installation,
 * see docs/plugin-system.md §2).
 */
export type PluginContext = {
  readonly manifest: Readonly<PluginManifest>;
  readonly appVersion: string;
  /** Namespaced key-value storage, persisted with the app's local data. */
  storage: PluginStorage;
  ui: {
    registerSelectionAction(action: PluginSelectionAction): PluginDisposable;
    registerHeaderAction(action: PluginHeaderAction): PluginDisposable;
    registerCommand(command: PluginCommand): PluginDisposable;
    showToast(message: string): void;
  };
  /**
   * Subscribe to app events; the disposable (also reclaimed on deactivate)
   * unsubscribes. `annotation-*` events need the `reading-data` permission —
   * subscribing without it throws at registration.
   */
  events: {
    on<K extends PluginEventName>(
      event: K,
      handler: (payload: PluginEventMap[K]) => void,
    ): PluginDisposable;
  };
  /** Requires the `ai` permission. */
  ai?: {
    registerTool(tool: PluginToolDefinition): PluginDisposable;
  };
  /** Requires the `network` permission. */
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  /**
   * Requires the `reading-data` permission — read AND write access to the
   * app's reading data: books (read), annotations (create/delete), and the
   * built-in vocabulary notebook (list/add/remove — the same store the
   * reader's dictionary saves into).
   */
  reading?: {
    listBooks(): Promise<PluginBookOverview[]>;
    listAnnotations(filter?: { bookId?: string }): Promise<PluginAnnotation[]>;
    createHighlight(input: {
      bookId: string;
      text: string;
      cfiRange?: string | null;
      chapterHref?: string | null;
      color?: "yellow" | "green" | "blue" | "pink";
      style?: "highlight" | "underline";
    }): Promise<PluginAnnotation>;
    createNote(input: {
      bookId: string;
      text: string;
      content: string;
      cfiRange?: string | null;
      chapterHref?: string | null;
    }): Promise<PluginAnnotation>;
    deleteAnnotation(id: string): Promise<void>;
    updateNote(id: string, content: string): Promise<void>;
    recolorHighlight(
      id: string,
      color: "yellow" | "green" | "blue" | "pink",
    ): Promise<void>;
    /** Chapter list of a book's extracted text (extraction runs on demand). */
    getToc(bookId: string): Promise<PluginChapterRef[]>;
    /** Plain text of one chapter by its toc index; null when unavailable. */
    getChapterText(bookId: string, chapterIndex: number): Promise<string | null>;
    vocabulary: {
      list(filter?: { query?: string; limit?: number }): Promise<PluginVocabularyEntry[]>;
      add(input: {
        term: string;
        language: string;
        entry: PluginDictionaryEntry;
        context?: string;
        bookTitle?: string;
      }): Promise<void>;
      remove(term: string, language: string): Promise<void>;
    };
  };
  /**
   * Requires the `dictionary` permission. The app's built-in dictionary —
   * shares its cache with the reader's own look-ups. Uses the user's
   * configured AI model; rejects when AI is not configured.
   */
  dictionary?: {
    lookUp(input: {
      term: string;
      context?: string;
      bookTitle?: string;
    }): Promise<PluginDictionaryResult>;
  };
  /**
   * Requires the `llm` permission. A one-shot model call on the user's
   * configured account (fast tier) — no thread, no memory, no tools.
   * Rejects when AI is not configured.
   */
  llm?: {
    ask(input: {
      prompt: string;
      system?: string;
      /** Model tier on the user's account; defaults to "fast". */
      model?: "fast" | "smart";
    }): Promise<string>;
  };
  /**
   * Requires the `library-write` permission: add real books to the shelf.
   * This is how content-provider plugins work (an RSS reader builds an EPUB
   * from fetched articles and imports it) — the reader, annotations, and AI
   * all treat the result as a first-class book.
   */
  library?: {
    importBook(input: {
      fileName: string;
      data: ArrayBuffer | Uint8Array;
    }): Promise<PluginBookOverview>;
  };
  /**
   * Ambient reader control (user-visible, no data exposure): open a book,
   * jump to a CFI or chapter href. `goTo` without `bookId` targets the open
   * book; with one, it opens that book first.
   */
  reader: {
    openBook(bookId: string): void;
    goTo(target: { bookId?: string; cfi?: string; href?: string }): void;
  };
  /** Requires the `clipboard` permission. */
  clipboard?: {
    writeText(text: string): Promise<void>;
  };
};

export type PluginChapterRef = {
  index: number;
  title?: string;
  /** Plain-text length, for budgeting reads. */
  chars: number;
};

export type PluginDictionaryEntry = {
  headword: string;
  pronunciation?: string;
  senses: { partOfSpeech: string; definition: string; examples: string[] }[];
  etymology?: string;
  contextualMeaning?: string;
};

export type PluginDictionaryResult = {
  /** The explanation language the entry was produced in. */
  language: string;
  entry: PluginDictionaryEntry;
};

export type PluginVocabularyEntry = {
  term: string;
  language: string;
  /** One-line rendering of the first sense. */
  definition: string;
  bookTitle?: string;
  context?: string;
  addedAt: string;
  entry: PluginDictionaryEntry;
};

/** The default export of a plugin's entry module. */
export type PluginModule = {
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
};
