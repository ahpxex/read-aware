import type { PluginContext, PluginDictionaryEntry } from "@read-aware/plugin-types";
import type { TargetLanguage } from "./languages";

export type SavedWord = {
  term: string;
  /** Human-readable explanation language the entry was produced in. */
  language: string;
  /** Stable locale preference used to regenerate the entry. */
  targetLanguage?: TargetLanguage;
  entry: PluginDictionaryEntry;
  context?: string;
  bookTitle?: string;
  addedAt: string;
};

export type SaveWordInput = {
  text: string;
  context?: string;
  bookId?: string;
  bookTitle?: string;
  language?: TargetLanguage;
};

/** The engine (lookup.ts) runs on the one-shot LLM service. */
export type DictionaryContext = PluginContext & {
  llm: NonNullable<PluginContext["llm"]>;
};

export type DictionaryPluginContext = DictionaryContext & {
  agent: NonNullable<PluginContext["agent"]>;
};

export function assertPluginCapabilities(
  ctx: PluginContext,
): asserts ctx is DictionaryPluginContext {
  if (!ctx.llm) {
    throw new Error('Dictionary requires the "service:llm" permission');
  }
  if (!ctx.agent) {
    throw new Error('Dictionary requires the "agent:tools" permission');
  }
}
