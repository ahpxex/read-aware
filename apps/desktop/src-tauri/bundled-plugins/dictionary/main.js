/**
 * Dictionary — the built-in dictionary, as a plugin.
 *
 * Looking a word up is an app service (service:dictionary); this plugin owns
 * the vertical around it: a "look up & save" selection action, the Vocabulary
 * notebook (saved words as plugin documents in the "words" collection, keyed
 * `<language> <term>` so re-saving updates the entry across books), and the
 * agent tools that read and write it. A Dictionary has a Vocabulary.
 */

const WORDS = "words";

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
  const { language, entry } = await ctx.dictionary.lookUp({
    term,
    context: input.context,
    bookTitle: input.bookTitle,
  });
  // Keep the source passage only when it's more than the word itself.
  const passage =
    input.context && input.context.trim().toLowerCase() !== term.toLowerCase()
      ? input.context.trim()
      : undefined;
  await words(ctx).put(
    idFor(term, language),
    { term, language, entry, context: passage, bookTitle: input.bookTitle, addedAt: new Date().toISOString() },
    { bookId: input.bookId },
  );
  return { term, language, entry };
}

/** The shared entry layout: the definition, its provenance, and remove. */
function wordBlocks(w, onRemove) {
  const provenance = [
    ...(w.bookTitle ? [{ label: "Book", value: w.bookTitle }] : []),
    ...(formatDate(w.addedAt) ? [{ label: "Added", value: formatDate(w.addedAt) }] : []),
  ];
  // Only a real passage, not the word echoed back (guards legacy data too).
  const passage =
    w.context && w.context.trim().toLowerCase() !== (w.term ?? "").trim().toLowerCase()
      ? w.context
      : undefined;
  return [
    { kind: "dictionary", entry: w.entry },
    ...(passage ? [{ kind: "quote", text: passage, caption: w.bookTitle }] : []),
    ...(provenance.length > 0 ? [{ kind: "divider" }, { kind: "keyValue", rows: provenance }] : []),
    { kind: "divider" },
    {
      kind: "actions",
      actions: [{ id: "remove", label: "Remove", icon: "trash", variant: "danger", run: onRemove }],
    },
  ];
}

/** @param {import("read-aware").PluginContext} ctx */
async function wordDetailView(ctx, doc) {
  const w = doc.data;
  return {
    kind: "blocks",
    // No title — the dictionary block already leads with the headword; a title
    // here would repeat it in the back-nav breadcrumb.
    blocks: wordBlocks(w, async () => {
      await words(ctx).delete(doc.id);
      return { toast: `Removed “${w.term}”`, view: await notebookView(ctx) };
    }),
  };
}

/** @param {import("read-aware").PluginContext} ctx */
async function notebookView(ctx) {
  const saved = await words(ctx).list();
  return {
    kind: "list",
    title: saved.length === 0 ? undefined : `${saved.length} word${saved.length === 1 ? "" : "s"}`,
    emptyText: "No saved words yet. Select a word while reading and choose “Look up & save”.",
    items: saved.map((doc) => ({
      id: doc.id,
      title: doc.data.term,
      subtitle: definitionOf(doc.data.entry),
      icon: "book-bookmark",
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
      run: async (input) => {
        const { term, language } = await saveWord(ctx, {
          text: input.text,
          context: input.text.trim().slice(0, 300),
          bookId: input.book.id,
          bookTitle: input.book.title,
        });
        const doc = await words(ctx).get(idFor(term, language));
        return {
          toast: `Saved “${term}”`,
          view: {
            kind: "blocks",
            blocks: wordBlocks(doc.data, async () => {
              await words(ctx).delete(idFor(term, language));
              return { close: true, toast: `Removed “${term}”` };
            }),
          },
        };
      },
    });

    ctx.ui.registerHeaderAction({
      id: "vocabulary",
      title: "Vocabulary",
      icon: "book-bookmark",
      surface: "shelf",
      presentation: "page",
      view: () => notebookView(ctx),
    });

    ctx.ui.registerCommand({
      id: "open",
      title: "Vocabulary: saved words",
      icon: "book-bookmark",
      keywords: "vocabulary words dictionary notebook",
      run: async () => ({ view: await notebookView(ctx) }),
    });

    ctx.agent.registerTool({
      name: "get_vocabulary",
      label: "Vocabulary",
      description:
        "List the words the reader saved to their vocabulary, each with a short definition and the book it came from. Call it WITHOUT query to see the whole list.",
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
        "Look up a word with the built-in dictionary and save it to the user's vocabulary. Include the sentence it appeared in when available.",
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
