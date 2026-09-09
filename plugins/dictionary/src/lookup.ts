/**
 * The dictionary ENGINE — this plugin's own since the host's
 * `service:dictionary` was retired: the lexicographer prompt and entry
 * schema run through the LLM host service's structured mode,
 * entries cache in the "lookups" document collection, and the explanation
 * language is a plugin preference ("auto" follows `ctx.locale`).
 */
import type { PluginDictionaryEntry } from "@read-aware/plugin-types";
import {
  LANGUAGE_NAME_BY_VALUE,
  isTargetLanguage,
  type TargetLanguage,
} from "./languages";
import type { DictionaryContext } from "./types";

const LANGUAGE_KEY = "language";
const LOOKUPS_COLLECTION = "lookups";

export function getTargetLanguage(ctx: DictionaryContext): TargetLanguage {
  const raw = ctx.services.storage.get(LANGUAGE_KEY);
  return isTargetLanguage(raw) ? raw : "auto";
}

export function saveTargetLanguage(ctx: DictionaryContext, language: TargetLanguage): void {
  ctx.services.storage.set(LANGUAGE_KEY, language);
}

/** Resolve a preference (possibly "auto") to a model-ready language name. */
export function resolveLanguageName(ctx: DictionaryContext, language: TargetLanguage): string {
  const concrete =
    language === "auto" ? (isTargetLanguage(ctx.locale) ? ctx.locale : "en") : language;
  return concrete === "auto" ? "English" : LANGUAGE_NAME_BY_VALUE[concrete];
}

const ENTRY_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    headword: { type: "string", description: "The term, kept in its original language" },
    pronunciation: { type: "string", description: "IPA; omit when unsure" },
    senses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          partOfSpeech: { type: "string" },
          definition: { type: "string" },
          examples: { type: "array", items: { type: "string" } },
        },
        required: ["definition"],
      },
    },
    etymology: { type: "string", description: "Origin and roots; omit if genuinely unknown" },
    contextualMeaning: {
      type: "string",
      description: "What the term means in the provided sentence; omit when no context is given",
    },
  },
  required: ["headword", "senses"],
};

const SYSTEM_PROMPT = [
  "You are a meticulous lexicographer embedded in a reading app.",
  "Given a term (a word or short phrase) and, optionally, the sentence it appears in,",
  "produce a rich, accurate dictionary entry.",
  "Requirements: write detailed, precise definitions — never a bare one-word gloss;",
  "give 1–2 natural example sentences per sense; cover the common senses of the term;",
  "include etymology whenever you know it.",
].join(" ");

/** Tolerant normalization of the schema-validated reply into the entry shape. */
function normalizeEntry(parsed: Partial<PluginDictionaryEntry>, term: string): PluginDictionaryEntry {
  const senses = Array.isArray(parsed.senses)
    ? parsed.senses
        .filter((sense) => !!sense && typeof sense.definition === "string")
        .map((sense) => ({
          partOfSpeech: typeof sense.partOfSpeech === "string" ? sense.partOfSpeech : "",
          definition: sense.definition,
          examples: Array.isArray(sense.examples)
            ? sense.examples.filter((example): example is string => typeof example === "string")
            : [],
        }))
    : [];
  return {
    headword:
      typeof parsed.headword === "string" && parsed.headword.trim()
        ? parsed.headword.trim()
        : term,
    pronunciation: typeof parsed.pronunciation === "string" ? parsed.pronunciation : undefined,
    senses,
    etymology: typeof parsed.etymology === "string" ? parsed.etymology : undefined,
    contextualMeaning:
      typeof parsed.contextualMeaning === "string" ? parsed.contextualMeaning : undefined,
  };
}

/** Stable cache id over the inputs that shape an entry (djb2, base36). */
export function lookupCacheId(term: string, languageName: string, context: string | undefined, bookTitle: string | undefined): string {
  const text = JSON.stringify([languageName, term.trim().toLowerCase(), context?.trim() ?? "", bookTitle ?? ""]);
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

type CachedLookup = {
  term: string;
  language: string;
  entry: PluginDictionaryEntry;
  context?: string;
  at: string;
};

export type LookUpTermInput = {
  term: string;
  source?: "selection" | "provided";
  context?: string;
  bookTitle?: string;
  /** Target language override; omitted means the saved preference. */
  language?: TargetLanguage;
};

export async function lookUpTerm(
  ctx: DictionaryContext,
  input: LookUpTermInput,
): Promise<{ entry: PluginDictionaryEntry; language: string }> {
  const term = input.term.trim();
  const languageName = resolveLanguageName(ctx, input.language ?? getTargetLanguage(ctx));
  const cache = ctx.services.storage.collection(LOOKUPS_COLLECTION);
  const originalId = lookupCacheId(term, languageName, input.context, input.bookTitle);

  // Existing entries are local data: a privacy opt-out must not disable reading them.
  const cached = await cache.get<CachedLookup>(originalId);
  if (cached?.data?.entry && Array.isArray(cached.data.entry.senses)) {
    return { entry: cached.data.entry, language: languageName };
  }

  const [selectionSetting, surroundingSetting] = input.context?.trim()
    ? await Promise.all([
        ctx.domains.settings.queries.read("ai.preferences.sendHighlightedText"),
        ctx.domains.settings.queries.read("ai.preferences.sendSurroundingContext"),
      ]) : [];
  const context = selectionSetting?.value === true && surroundingSetting?.value === true ? input.context : undefined;
  const id = lookupCacheId(term, languageName, context, input.bookTitle);
  if (id !== originalId) {
    const withoutPassage = await cache.get<CachedLookup>(id);
    if (withoutPassage?.data?.entry && Array.isArray(withoutPassage.data.entry.senses)) {
      return { entry: withoutPassage.data.entry, language: languageName };
    }
  }
  const selected = input.source === "selection";
  const prompt = [
    selected ? "Define the term supplied in the host reading context's selection field." : `Term to define: ${JSON.stringify(term)}.`,
    context ? "Use the host reading context's surrounding field to identify its meaning in the passage." : "",
    input.bookTitle ? `The book is ${JSON.stringify(input.bookTitle)}.` : "",
    "Write every human-readable field (definitions, part-of-speech labels, examples, " +
      `etymology, contextual meaning) in ${languageName}.`,
    "Keep the headword itself in its original language.",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = (await ctx.services.llm.ask({
    prompt,
    system: SYSTEM_PROMPT,
    schema: ENTRY_SCHEMA,
    readingContext: selected || context ? {
      selection: selected ? term : undefined,
      surrounding: context,
      // Required fragments make a settings race fail instead of caching a different request.
      required: [...(selected ? ["selection" as const] : []), ...(context ? ["surrounding" as const] : [])],
    } : undefined,
  })) as Partial<PluginDictionaryEntry>;
  const entry = normalizeEntry(raw, term);

  await cache.put(id, {
    term,
    language: languageName,
    entry,
    context,
    at: new Date().toISOString(),
  } satisfies CachedLookup);

  return { entry, language: languageName };
}
