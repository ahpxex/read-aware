/**
 * The vocabulary notebook — words the reader saved from the dictionary.
 * Deduplicated by term + explanation-language; stores a snapshot of the entry
 * plus light provenance (the passage and book it came from).
 *
 * Vocabulary is DOMAIN data (part of the user's reading trace): writes
 * dual-write `vocabulary.added` / `vocabulary.removed` into the event log; the
 * localKV list below is the interim projection (like the other interim
 * stores, replaced by the SQLite projection table when that lands).
 */
import type { EventOrigin } from "@read-aware/core";
import { localKV } from "../../../platform/local-store";
import { emitDomainEvents } from "../../../platform/domain-events";
import type { DictionaryEntry } from "@read-aware/agent";

const STORAGE_KEY = "read-aware-vocabulary";

export interface VocabularyItem {
  /** term + language, lowercased — the dedupe identity. */
  id: string;
  term: string;
  language: string;
  entry: DictionaryEntry;
  context?: string;
  bookId?: string;
  bookTitle?: string;
  addedAt: number;
}

function idFor(term: string, language: string): string {
  return `${language} ${term.trim().toLowerCase()}`;
}

export function getVocabulary(): VocabularyItem[] {
  try {
    const raw = localKV.getItem(STORAGE_KEY);
    const items = raw ? (JSON.parse(raw) as VocabularyItem[]) : [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function write(items: VocabularyItem[]): void {
  localKV.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function isInVocabulary(term: string, language: string): boolean {
  const id = idFor(term, language);
  return getVocabulary().some((item) => item.id === id);
}

export function addToVocabulary(
  input: {
    term: string;
    language: string;
    entry: DictionaryEntry;
    context?: string;
    bookId?: string;
    bookTitle?: string;
  },
  origin?: EventOrigin,
): void {
  const id = idFor(input.term, input.language);
  const items = getVocabulary().filter((item) => item.id !== id);
  const item: VocabularyItem = {
    id,
    term: input.term.trim(),
    language: input.language,
    entry: input.entry,
    context: input.context,
    bookId: input.bookId,
    bookTitle: input.bookTitle,
    addedAt: Date.now(),
  };
  items.push(item);
  emitDomainEvents({
    type: "vocabulary.added",
    payload: {
      entryId: id,
      term: item.term,
      language: item.language,
      entry: item.entry,
      context: item.context,
      bookId: item.bookId,
      bookTitle: item.bookTitle,
    },
    origin,
  });
  write(items);
}

export function removeFromVocabulary(
  term: string,
  language: string,
  origin?: EventOrigin,
): void {
  const id = idFor(term, language);
  const items = getVocabulary();
  if (!items.some((item) => item.id === id)) return;
  emitDomainEvents({ type: "vocabulary.removed", payload: { entryId: id }, origin });
  write(items.filter((item) => item.id !== id));
}
