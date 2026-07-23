/**
 * VocabularyPort — a direct pass-through to the shared domain layer (origin
 * "agent"): the agent's VocabularyEntry IS the canonical VocabularySummary,
 * including the domain's one-place definition formatting. Read-only —
 * saving stays with the dictionary UI (and the vocabulary:write plugins).
 */
import type { VocabularyPort } from "@read-aware/agent";
import { createVocabularyDomain } from "../../../../domain";

export function createVocabularyPort(): VocabularyPort {
  const vocabulary = createVocabularyDomain("agent");
  return {
    listVocabulary: async (filter = {}) => vocabulary.list(filter),
  };
}
