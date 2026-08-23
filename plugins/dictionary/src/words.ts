import type { PluginDocument, PluginDocumentCollection } from "@read-aware/plugin-types";
import { idFor } from "./format";
import { isTargetLanguage, type TargetLanguage } from "./languages";
import { getTargetLanguage, lookUpTerm, saveTargetLanguage } from "./lookup";
import type { DictionaryContext, SavedWord, SaveWordInput } from "./types";

const WORDS_COLLECTION = "words";

export function wordCollection(ctx: DictionaryContext): PluginDocumentCollection {
  return ctx.services.storage.collection(WORDS_COLLECTION);
}

export async function saveWord(
  ctx: DictionaryContext,
  input: SaveWordInput,
): Promise<Pick<SavedWord, "term" | "language" | "targetLanguage" | "entry">> {
  const term = input.text.trim().slice(0, 60);
  const targetLanguage = input.language ?? getTargetLanguage(ctx);
  const { language, entry } = await lookUpTerm(ctx, {
    term,
    context: input.context,
    bookTitle: input.bookTitle,
    language: targetLanguage,
  });
  const passage =
    input.context && input.context.trim().toLowerCase() !== term.toLowerCase()
      ? input.context.trim()
      : undefined;

  await wordCollection(ctx).put(
    idFor(term, language),
    {
      term,
      language,
      targetLanguage,
      entry,
      context: passage,
      bookTitle: input.bookTitle,
      addedAt: new Date().toISOString(),
    } satisfies SavedWord,
    { bookId: input.bookId },
  );

  return { term, language, targetLanguage, entry };
}

export async function changeWordLanguage(
  ctx: DictionaryContext,
  doc: PluginDocument<SavedWord>,
  targetLanguage: TargetLanguage,
): Promise<PluginDocument<SavedWord>> {
  if (!isTargetLanguage(targetLanguage)) {
    throw new Error(`Unsupported target language: ${String(targetLanguage)}`);
  }

  const word = doc.data;
  const { language, entry } = await lookUpTerm(ctx, {
    term: word.term,
    context: word.context,
    bookTitle: word.bookTitle,
    language: targetLanguage,
  });
  const nextData: SavedWord = { ...word, language, targetLanguage, entry };
  const nextId = idFor(word.term, language);

  await wordCollection(ctx).put(nextId, nextData, {
    bookId: doc.bookId,
    anchor: doc.anchor,
  });
  if (nextId !== doc.id) await wordCollection(ctx).delete(doc.id);
  saveTargetLanguage(ctx, targetLanguage);

  return {
    ...doc,
    id: nextId,
    data: nextData,
    updatedAt: new Date().toISOString(),
  };
}
