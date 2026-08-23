import type { PluginToolWordCards } from "@read-aware/plugin-types";
import { definitionOf } from "./format";
import { lookUpTerm } from "./lookup";
import type { DictionaryPluginContext, SavedWord } from "./types";
import { saveWord, wordCollection } from "./words";

export function registerAgentTools(ctx: DictionaryPluginContext): void {
  // The open book's title sharpens contextual senses; session facts carry it.
  let currentBookTitle: string | undefined;
  ctx.services.session.subscribe("book-opened", ({ book }) => {
    currentBookTitle = book.title;
  });
  ctx.services.session.subscribe("book-closed", () => {
    currentBookTitle = undefined;
  });

  ctx.contributions.agentRetrievalProviders.register({
    id: "saved-vocabulary",
    label: "Search saved vocabulary",
    description:
      "Search words the reader saved in Dictionary, including their definitions and source passages.",
    contexts: ["book", "global"],
    retrieve: async ({ query, limit }) => {
      const needle = query.trim().toLowerCase();
      const saved = await wordCollection(ctx).list<SavedWord>();
      return saved
        .map(({ data: word }) => ({
          title: word.term,
          content: [definitionOf(word.entry), word.context].filter(Boolean).join(" — "),
          location: word.bookTitle,
        }))
        .filter((item) =>
          `${item.title} ${item.content}`.toLowerCase().includes(needle)
        )
        .slice(0, limit);
    },
  });

  ctx.contributions.agentTools.register({
    name: "lookup_word",
    label: "Look up word",
    contexts: ["book", "global"],
    description:
      "Look up a word or short phrase in the AI dictionary and show the reader a word card with the full entry (pronunciation, senses, examples, etymology). Use it when the reader asks what a word means or when a precise definition genuinely helps; pass the surrounding sentence as context when you have it. The reader sees the full card; you receive only a one-line gist — the card IS the explanation, so after calling say nothing more about the definition, or add a single remark that ties the word to the passage or conversation. One lookup per word per reply: never call it again for a word whose card is already showing in this reply.",
    parameters: {
      type: "object",
      properties: {
        term: {
          type: "string",
          description: "The word or short phrase to define, in its original language.",
        },
        context: {
          type: "string",
          description: "The sentence or passage it appears in — sharpens the contextual sense.",
        },
      },
      required: ["term"],
      additionalProperties: false,
    },
    execute: async (params) => {
      const term = String(params.term ?? "").trim();
      if (!term) throw new Error("term is required");
      const context = typeof params.context === "string" ? params.context : undefined;
      const { entry, language } = await lookUpTerm(ctx, {
        term,
        context,
        bookTitle: currentBookTitle,
      });
      const headword = entry.headword || term;
      // The model gets a one-line gist; the full entry rides the word card.
      // Returning the whole JSON invites the model to restate it in prose.
      return {
        gist: {
          presented: headword,
          definition: entry.senses[0]?.definition,
          contextualMeaning: entry.contextualMeaning,
          note: "The reader is now looking at the full entry card (pronunciation, every sense with examples, etymology). Do not repeat any of it in prose.",
        },
        wordCards: [{ term: headword, language, entry }],
      } satisfies PluginToolWordCards;
    },
  });

  ctx.contributions.agentTools.register({
    name: "get_vocabulary",
    label: "Saved words",
    contexts: ["book", "global"],
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

  ctx.contributions.agentTools.register({
    name: "save_word",
    label: "Save word",
    contexts: ["book", "global"],
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
