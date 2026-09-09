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
  services: PluginContext["services"] & {
    llm: NonNullable<PluginContext["services"]["llm"]>;
  };
};

export type DictionaryPluginContext = DictionaryContext & {
  domains: PluginContext["domains"] & {
    reading: NonNullable<PluginContext["domains"]["reading"]>;
    library: NonNullable<PluginContext["domains"]["library"]>;
  };
  contributions: PluginContext["contributions"] & {
    agentTools: NonNullable<PluginContext["contributions"]["agentTools"]>;
    agentRetrievalProviders: NonNullable<
      PluginContext["contributions"]["agentRetrievalProviders"]
    >;
  };
};

export function assertPluginCapabilities(
  ctx: PluginContext,
): asserts ctx is DictionaryPluginContext {
  if (!ctx.domains.reading || !ctx.domains.library) {
    throw new Error('Dictionary requires "reading:read" and "library:read" permissions');
  }
  if (!ctx.services.llm) {
    throw new Error('Dictionary requires the "service:llm" permission');
  }
  if (!ctx.contributions.agentTools) {
    throw new Error('Dictionary requires the "agent:tools" permission');
  }
  if (!ctx.contributions.agentRetrievalProviders) {
    throw new Error('Dictionary requires the "agent:retrieval" permission');
  }
}
