/**
 * Dictionary — the built-in dictionary, as a plugin.
 *
 * Looking a word up is an app service (service:dictionary); this plugin owns
 * the vertical around it: a "look up & save" selection action, the saved-word
 * timeline (plugin documents in the "words" collection, keyed
 * `<language> <term>` so re-saving updates the entry across books), and the
 * agent tools that read and write it.
 */

const WORDS = "words";
const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Match app language" },
  { value: "en", label: "English" },
  { value: "zh-Hans", label: "简体中文" },
  { value: "zh-Hant", label: "繁體中文" },
  { value: "ja", label: "日本語" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "ru", label: "Русский" },
  { value: "es", label: "Español" },
];
const LANGUAGE_VALUE_BY_NAME = {
  English: "en",
  "Simplified Chinese": "zh-Hans",
  "Traditional Chinese": "zh-Hant",
  Japanese: "ja",
  French: "fr",
  German: "de",
  Russian: "ru",
  Spanish: "es",
};
const isTargetLanguage = (value) =>
  LANGUAGE_OPTIONS.some((option) => option.value === value);

/** term + language, lowercased — the dedupe identity. */
const idFor = (term, language) => `${language} ${term.trim().toLowerCase()}`;

/** @param {import("read-aware").PluginContext} ctx */
const words = (ctx) => ctx.storage.collection(WORDS);

/** One-line rendering of the first sense, part-of-speech prefixed. */
function definitionOf(entry) {
  const first = entry.senses?.[0];
  if (!first) return entry.contextualMeaning ?? "";
  return first.partOfSpeech ? `(${first.partOfSpeech}) ${first.definition}` : first.definition;
}

function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** @param {import("read-aware").PluginContext} ctx */
async function saveWord(ctx, input) {
  const term = input.text.trim().slice(0, 60);
  const targetLanguage = input.language ?? ctx.dictionary.getLanguage();
  const { language, entry } = await ctx.dictionary.lookUp({
    term,
    context: input.context,
    bookTitle: input.bookTitle,
    language: targetLanguage,
  });
  // Keep the source passage only when it's more than the word itself.
  const passage =
    input.context && input.context.trim().toLowerCase() !== term.toLowerCase()
      ? input.context.trim()
      : undefined;
  await words(ctx).put(
    idFor(term, language),
    {
      term,
      language,
      targetLanguage,
      entry,
      context: passage,
      bookTitle: input.bookTitle,
      addedAt: new Date().toISOString(),
    },
    { bookId: input.bookId },
  );
  return { term, language, targetLanguage, entry };
}

/** The shared host-rendered detail: definition, metadata footer, and actions. */
function wordDetail(w, targetLanguage, onLanguageChange, onRemove) {
  const metadata = [
    ...(w.bookTitle ? [{ kind: "label", label: "Book", value: w.bookTitle, icon: "book-open" }] : []),
    ...(formatDate(w.addedAt)
      ? [{ kind: "label", label: "Added", value: formatDate(w.addedAt), icon: "calendar" }]
      : []),
  ];
  // Only a real passage, not the word echoed back (guards legacy data too).
  const passage =
    w.context && w.context.trim().toLowerCase() !== (w.term ?? "").trim().toLowerCase()
      ? w.context
      : undefined;
  return {
    kind: "detail",
    content: [
      { kind: "dictionary", entry: w.entry },
      ...(passage ? [{ kind: "quote", text: passage, caption: w.bookTitle }] : []),
    ],
    metadata,
    controls: [
      {
        kind: "select",
        id: "target-language",
        label: "Target language",
        value: targetLanguage,
        icon: "translate",
        options: LANGUAGE_OPTIONS,
        onChange: onLanguageChange,
      },
    ],
    actions: [
      {
        id: "remove",
        label: "Delete word",
        icon: "trash",
        variant: "danger",
        run: onRemove,
      },
    ],
  };
}

/** @param {import("read-aware").PluginContext} ctx */
async function wordDetailView(ctx, doc) {
  const w = doc.data;
  const inferredLanguage =
    w.targetLanguage ?? LANGUAGE_VALUE_BY_NAME[w.language] ?? ctx.dictionary.getLanguage();
  const targetLanguage = isTargetLanguage(inferredLanguage)
    ? inferredLanguage
    : ctx.dictionary.getLanguage();
  return wordDetail(
    w,
    targetLanguage,
    (nextLanguage) => changeWordLanguage(ctx, doc, nextLanguage),
    async () => {
      await words(ctx).delete(doc.id);
      return { close: true, toast: `Deleted “${w.term}”` };
    },
  );
}

/** @param {import("read-aware").PluginContext} ctx */
async function changeWordLanguage(ctx, doc, targetLanguage) {
  const w = doc.data;
  if (!isTargetLanguage(targetLanguage)) {
    throw new Error(`Unsupported target language: ${String(targetLanguage)}`);
  }
  if (targetLanguage === w.targetLanguage) return undefined;
  const { language, entry } = await ctx.dictionary.lookUp({
    term: w.term,
    context: w.context,
    bookTitle: w.bookTitle,
    language: targetLanguage,
  });
  const nextData = { ...w, language, targetLanguage, entry };
  const nextId = idFor(w.term, language);
  await words(ctx).put(nextId, nextData, { bookId: doc.bookId, anchor: doc.anchor });
  if (nextId !== doc.id) await words(ctx).delete(doc.id);
  ctx.dictionary.setLanguage(targetLanguage);
  return {
    view: await wordDetailView(ctx, {
      ...doc,
      id: nextId,
      data: nextData,
      updatedAt: new Date().toISOString(),
    }),
    navigation: "replace",
  };
}

/** @param {import("read-aware").PluginContext} ctx */
async function notebookView(ctx) {
  const saved = await words(ctx).list();
  return {
    kind: "list",
    emptyText: "No saved words yet. Select a word while reading and choose “Look up & save”.",
    searchable: true,
    searchPlaceholder: "Search saved words",
    timeline: true,
    items: saved.map((doc) => ({
      id: doc.id,
      title: doc.data.term,
      subtitle: definitionOf(doc.data.entry),
      timestamp: doc.data.addedAt,
      icon: "book-bookmark",
      keywords: [doc.data.language, doc.data.bookTitle, doc.data.context].filter(Boolean),
      accessories: doc.data.bookTitle
        ? [{ kind: "text", text: doc.data.bookTitle }]
        : undefined,
      presentation: "dialog",
      onSelect: async () => ({ view: await wordDetailView(ctx, doc) }),
    })),
  };
}

export default {
  /** @param {import("read-aware").PluginContext} ctx */
  activate(ctx) {
    ctx.ui.registerSelectionAction({
      id: "lookup-save",
      title: "Look up & save",
      icon: "book-bookmark",
      presentation: "dialog",
      run: async (input) => {
        const { term, language } = await saveWord(ctx, {
          text: input.text,
          context: input.text.trim().slice(0, 300),
          bookId: input.book.id,
          bookTitle: input.book.title,
        });
        const doc = await words(ctx).get(idFor(term, language));
        if (!doc) throw new Error(`Could not load saved word “${term}”`);
        return {
          toast: `Saved “${term}”`,
          view: await wordDetailView(ctx, doc),
        };
      },
    });

    ctx.ui.registerHeaderAction({
      id: "vocabulary",
      title: "Dictionary",
      icon: "book-bookmark",
      surface: "shelf",
      presentation: "page",
      view: () => notebookView(ctx),
    });

    ctx.ui.registerCommand({
      id: "open",
      title: "Dictionary: saved words",
      icon: "book-bookmark",
      keywords: "saved words dictionary notebook",
      run: async () => ({ view: await notebookView(ctx) }),
    });

    ctx.agent.registerTool({
      name: "get_vocabulary",
      label: "Saved words",
      description:
        "List the words the reader saved in Dictionary, each with a short definition and the book it came from. Call it WITHOUT query to see the whole list.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text filter over saved words. Omit to list all." },
          limit: { type: "number", description: "Max entries (default 50)." },
        },
        additionalProperties: false,
      },
      execute: async (params) => {
        const needle = typeof params.query === "string" ? params.query.trim().toLowerCase() : "";
        const limit =
          typeof params.limit === "number" && params.limit > 0
            ? Math.min(200, Math.floor(params.limit))
            : 50;
        const saved = await words(ctx).list();
        return saved
          .map((doc) => ({
            term: doc.data.term,
            language: doc.data.language,
            definition: definitionOf(doc.data.entry),
            bookTitle: doc.data.bookTitle,
            context: doc.data.context,
            addedAt: doc.data.addedAt,
          }))
          .filter(
            (w) =>
              !needle ||
              w.term.toLowerCase().includes(needle) ||
              w.definition.toLowerCase().includes(needle),
          )
          .slice(0, limit);
      },
    });

    ctx.agent.registerTool({
      name: "save_word",
      label: "Save word",
      description:
        "Look up a word with the built-in Dictionary and save it. Include the sentence it appeared in when available.",
      parameters: {
        type: "object",
        properties: {
          word: { type: "string", description: "The word or phrase to save." },
          context: { type: "string", description: "The sentence it appeared in." },
          bookTitle: { type: "string", description: "Book title, if known." },
        },
        required: ["word"],
        additionalProperties: false,
      },
      execute: async (params) => {
        const term = String(params.word ?? "").trim();
        if (!term) throw new Error("word is required");
        const { language } = await saveWord(ctx, {
          text: term,
          context: typeof params.context === "string" ? params.context : undefined,
          bookTitle: typeof params.bookTitle === "string" ? params.bookTitle : undefined,
        });
        return { saved: term, language, total: (await words(ctx).list()).length };
      },
    });
  },
};
