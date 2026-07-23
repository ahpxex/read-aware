/**
 * Vocabulary domain — the notebook the reader's dictionary saves into.
 * `definition` formatting (part-of-speech prefixed first sense) lives here,
 * once, for every consumer.
 */
import type { EventOrigin, VocabularySummary } from "@read-aware/core";
import {
  addToVocabulary,
  getVocabulary,
  removeFromVocabulary,
  type VocabularyItem,
} from "../features/reader/lib/vocabulary";
import { VOCABULARY_EVENTS, domainSubscribe, type DomainEventSubscribe } from "./events";

export function toVocabularySummary(item: VocabularyItem): VocabularySummary {
  const first = item.entry.senses[0];
  const definition = first
    ? first.partOfSpeech
      ? `(${first.partOfSpeech}) ${first.definition}`
      : first.definition
    : (item.entry.contextualMeaning ?? "");
  return {
    term: item.term,
    language: item.language,
    definition,
    entry: item.entry,
    context: item.context,
    bookId: item.bookId,
    bookTitle: item.bookTitle,
    addedAt: new Date(item.addedAt).toISOString(),
  };
}

export type VocabularyDomain = {
  list(filter?: { query?: string; limit?: number }): Promise<VocabularySummary[]>;
  on: DomainEventSubscribe<(typeof VOCABULARY_EVENTS)[number]>;
  add(input: {
    term: string;
    language: string;
    entry: VocabularySummary["entry"];
    context?: string;
    bookId?: string;
    bookTitle?: string;
  }): Promise<void>;
  remove(term: string, language: string): Promise<void>;
};

export function createVocabularyDomain(origin: EventOrigin): VocabularyDomain {
  return {
    list: async (filter) => {
      const needle = filter?.query?.trim().toLowerCase();
      const entries = [...getVocabulary()]
        .sort((a, b) => b.addedAt - a.addedAt)
        .map(toVocabularySummary)
        .filter(
          (entry) =>
            !needle ||
            entry.term.toLowerCase().includes(needle) ||
            entry.definition.toLowerCase().includes(needle),
        );
      return typeof filter?.limit === "number" ? entries.slice(0, filter.limit) : entries;
    },
    on: domainSubscribe(VOCABULARY_EVENTS, origin),
    add: async (input) => {
      addToVocabulary(
        {
          term: String(input.term),
          language: String(input.language),
          entry: input.entry,
          context: input.context,
          bookId: input.bookId,
          bookTitle: input.bookTitle,
        },
        origin,
      );
    },
    remove: async (term, language) => {
      removeFromVocabulary(String(term), String(language), origin);
    },
  };
}
