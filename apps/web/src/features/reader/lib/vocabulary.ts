/**
 * A device-local vocabulary list — words the reader saved from the dictionary.
 * Deduplicated by term + explanation-language; stores a snapshot of the entry
 * plus light provenance (the passage and book it came from) so a future
 * vocabulary view can show where each word was met.
 */
import { localKV } from "../../../platform/local-store";
import type { DictionaryEntry } from "@read-aware/agent";

const STORAGE_KEY = "read-aware-vocabulary";

export interface VocabularyItem {
  /** term + language, lowercased — the dedupe identity. */
  id: string;
  term: string;
  language: string;
  entry: DictionaryEntry;
  context?: string;
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

export function addToVocabulary(input: {
  term: string;
  language: string;
  entry: DictionaryEntry;
  context?: string;
  bookTitle?: string;
}): void {
  const id = idFor(input.term, input.language);
  const items = getVocabulary().filter((item) => item.id !== id);
  items.push({
    id,
    term: input.term.trim(),
    language: input.language,
    entry: input.entry,
    context: input.context,
    bookTitle: input.bookTitle,
    addedAt: Date.now(),
  });
  write(items);
}

export function removeFromVocabulary(term: string, language: string): void {
  const id = idFor(term, language);
  write(getVocabulary().filter((item) => item.id !== id));
}
