/**
 * The vocabulary notebook — words the reader saved from the dictionary.
 * Deduplicated by term + explanation-language; stores a snapshot of the entry
 * plus light provenance (the passage and book it came from).
 *
 * Vocabulary is DOMAIN data (part of the user's reading trace): writes
 * dual-write `vocabulary.added` / `vocabulary.removed` into the event log,
 * and the projection is the SQLite `vocabulary_entries` table (migration
 * v9), read through the boot-hydrated snapshot in
 * platform/interim-projections so every read here stays synchronous. The
 * browser shell (dev / Storybook) falls back to localStorage.
 */
import type { EventOrigin } from "@read-aware/core";
import { isTauri } from "../../../platform/environment";
import { localKV } from "../../../platform/local-store";
import { emitDomainEvents } from "../../../platform/domain-events";
import {
  getVocabularyRows,
  putVocabularyRow,
  removeVocabularyRow,
  type VocabularyEntryRow,
} from "../../../platform/interim-projections";
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

function rowToItem(row: VocabularyEntryRow): VocabularyItem | null {
  try {
    const entry = JSON.parse(row.entryJson) as DictionaryEntry | null;
    if (!entry) return null;
    return {
      id: row.id,
      term: row.term,
      language: row.language,
      entry,
      context: row.context,
      bookId: row.bookId,
      bookTitle: row.bookTitle,
      addedAt: Date.parse(row.addedAt),
    };
  } catch {
    return null;
  }
}

function itemToRow(item: VocabularyItem): VocabularyEntryRow {
  return {
    id: item.id,
    term: item.term,
    language: item.language,
    entryJson: JSON.stringify(item.entry),
    context: item.context,
    bookId: item.bookId,
    bookTitle: item.bookTitle,
    addedAt: new Date(item.addedAt).toISOString(),
  };
}

// Converted view of the platform snapshot, invalidated on writes.
let itemsMemo: { source: VocabularyEntryRow[]; items: VocabularyItem[] } | null = null;

function readBrowserItems(): VocabularyItem[] {
  try {
    const raw = localKV.getItem(STORAGE_KEY);
    const items = raw ? (JSON.parse(raw) as VocabularyItem[]) : [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function writeBrowserItems(items: VocabularyItem[]): void {
  localKV.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function getVocabulary(): VocabularyItem[] {
  if (!isTauri()) return readBrowserItems();
  const source = getVocabularyRows();
  if (!itemsMemo || itemsMemo.source !== source) {
    itemsMemo = {
      source,
      items: source.map(rowToItem).filter((item): item is VocabularyItem => item !== null),
    };
  }
  return itemsMemo.items;
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
  if (!isTauri()) {
    writeBrowserItems([...readBrowserItems().filter((existing) => existing.id !== id), item]);
    return;
  }
  putVocabularyRow(itemToRow(item));
}

export function removeFromVocabulary(
  term: string,
  language: string,
  origin?: EventOrigin,
): void {
  const id = idFor(term, language);
  if (!getVocabulary().some((item) => item.id === id)) return;
  emitDomainEvents({ type: "vocabulary.removed", payload: { entryId: id }, origin });
  if (!isTauri()) {
    writeBrowserItems(readBrowserItems().filter((item) => item.id !== id));
    return;
  }
  removeVocabularyRow(id);
}
