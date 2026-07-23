/**
 * Vocabulary — the built-in vocabulary notebook, as a plugin.
 *
 * The full vertical lives here: look a word up from the selection, save it
 * with its dictionary entry and provenance, browse and remove saved words,
 * and expose the notebook to the reading agent. Words are plugin documents
 * (collection "words", keyed `<language> <term>` so re-saving a word updates
 * it across books); the dictionary itself stays an app service.
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

/** @param {import("read-aware").PluginContext} ctx */
async function saveWord(ctx, input) {
  const term = input.text.trim().slice(0, 60);
  const { language, entry } = await ctx.dictionary.lookUp({
    term,
    context: input.context,
    bookTitle: input.bookTitle,
  });
  await words(ctx).put(
    idFor(term, language),
    {
      term: term,
      language,
      entry,
      context: input.context,
      bookTitle: input.bookTitle,
      addedAt: new Date().toISOString(),
    },
    { bookId: input.bookId },
  );
  return { term, language, entry };
}

/** @param {import("read-aware").PluginContext} ctx */
async function wordDetailView(ctx, doc) {
  const w = doc.data;
  return {
    kind: "blocks",
    title: w.term,
    blocks: [
      { kind: "dictionary", entry: w.entry },
      ...(w.context ? [{ kind: "quote", text: w.context, caption: w.bookTitle }] : []),
      {
        kind: "keyValue",
        rows: [
          { label: "Language", value: w.language },
          { label: "Added", value: (w.addedAt ?? "").slice(0, 10) },
          ...(w.bookTitle ? [{ label: "Book", value: w.bookTitle }] : []),
        ],
      },
      { kind: "divider" },
      {
        kind: "actions",
        actions: [
          {
            id: "remove",
            label: "Remove",
            variant: "danger",
            run: async () => {
              await words(ctx).delete(doc.id);
              return { toast: `Removed “${w.term}”`, view: await notebookView(ctx) };
            },
          },
        ],
      },
    ],
  };
}

/** @param {import("read-aware").PluginContext} ctx */
async function notebookView(ctx) {
  const saved = await words(ctx).list();
  return {
    kind: "list",
    title: `${saved.length} word${saved.length === 1 ? "" : "s"}`,
    emptyText: "Nothing saved yet — select a word while reading.",
    items: saved.map((doc) => ({
      id: doc.id,
      title: doc.data.term,
      subtitle: [definitionOf(doc.data.entry).slice(0, 60), doc.data.bookTitle]
        .filter(Boolean)
        .join(" · "),
      icon: "notebook",
      onSelect: async () => ({ view: await wordDetailView(ctx, doc) }),
    })),
  };
}

export default {
  /** @param {import("read-aware").PluginContext} ctx */
  activate(ctx) {
    ctx.ui.registerSelectionAction({
      id: "save-word",
      title: "Save to vocabulary",
      icon: "notebook",
      run: async (input) => {
        const { term, language, entry } = await saveWord(ctx, {
          text: input.text,
          context: input.text.trim().slice(0, 300),
          bookId: input.book.id,
          bookTitle: input.book.title,
        });
        return {
          toast: `Saved “${term}”`,
          view: {
            kind: "blocks",
            title: term,
            blocks: [
              { kind: "dictionary", entry },
              {
                kind: "actions",
                actions: [
                  {
                    id: "undo",
                    label: "Remove from vocabulary",
                    variant: "ghost",
                    run: async () => {
                      await words(ctx).delete(idFor(term, language));
                      return { close: true, toast: `Removed “${term}”` };
                    },
                  },
                ],
              },
            ],
          },
        };
      },
    });

    ctx.ui.registerHeaderAction({
      id: "notebook",
      title: "Vocabulary",
      icon: "notebook",
      surface: "shelf",
      presentation: "page",
      view: () => notebookView(ctx),
    });

    ctx.ui.registerCommand({
      id: "open",
      title: "Vocabulary: saved words",
      icon: "notebook",
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
        const needle =
          typeof params.query === "string" ? params.query.trim().toLowerCase() : "";
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
