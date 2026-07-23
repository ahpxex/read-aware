import type {
  PluginContext,
  PluginDictionaryEntry,
  PluginDictionaryLanguage,
} from "@read-aware/plugin-types";

export type SavedWord = {
  term: string;
  /** Human-readable explanation language returned by the dictionary service. */
  language: string;
  /** Stable locale preference used to regenerate the entry. */
  targetLanguage?: PluginDictionaryLanguage;
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
  language?: PluginDictionaryLanguage;
};

export type DictionaryContext = PluginContext & {
  dictionary: NonNullable<PluginContext["dictionary"]>;
};

export type DictionaryPluginContext = DictionaryContext & {
  agent: NonNullable<PluginContext["agent"]>;
};

export function assertPluginCapabilities(
  ctx: PluginContext,
): asserts ctx is DictionaryPluginContext {
  if (!ctx.dictionary) {
    throw new Error('Dictionary requires the "service:dictionary" permission');
  }
  if (!ctx.agent) {
    throw new Error('Dictionary requires the "agent:tools" permission');
  }
}
