import { definitionOf } from "./format";
import type { DictionaryPluginContext, SavedWord } from "./types";
import { saveWord, wordCollection } from "./words";

export function registerAgentTools(ctx: DictionaryPluginContext): void {
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
      const saved = await wordCollection(ctx).list<SavedWord>();
      return saved
        .map(({ data: word }) => ({
          term: word.term,
          language: word.language,
          definition: definitionOf(word.entry),
          bookTitle: word.bookTitle,
          context: word.context,
          addedAt: word.addedAt,
        }))
        .filter(
          (word) =>
            !needle ||
            word.term.toLowerCase().includes(needle) ||
            word.definition.toLowerCase().includes(needle),
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
      return {
        saved: term,
        language,
        total: (await wordCollection(ctx).list<SavedWord>()).length,
      };
    },
  });
}
