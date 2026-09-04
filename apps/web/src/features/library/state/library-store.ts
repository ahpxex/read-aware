import { atom } from "jotai";
import type { Collection, LibraryBook } from "../lib/library-types";

/**
 * The shelf's in-memory projection — ONE list of books, ONE list of
 * collections, shared by every surface that paints them (shelf, command
 * palette, stats, reader chrome). Writers are the library hooks: the loader
 * (full reload / single-row refresh), the importer (placeholders and landed
 * books), and the commands (optimistic edits with rollback).
 *
 * Pure updaters live beside the atoms so hooks stay thin and the list
 * semantics (upsert keeps position, insert goes to the front) are testable.
 */

export const libraryBooksAtom = atom<LibraryBook[]>([]);
export const libraryCollectionsAtom = atom<Collection[]>([]);
export const libraryReadyAtom = atom(false);

/**
 * Imports whose file is still being copied: full shelf records (final id,
 * file-name title) so the shelf sorts them into the slot the committed book
 * will occupy. Removed the moment the import lands or fails.
 */
export const pendingImportsAtom = atom<LibraryBook[]>([]);
/** Sources still in the import pipeline (header disabled state, empty-shelf gate). */
export const importingCountAtom = atom(0);

/** Replace a book in place, or add it to the front when it is new. */
export function upsertBook(books: LibraryBook[], next: LibraryBook): LibraryBook[] {
  return books.some((book) => book.id === next.id)
    ? books.map((book) => (book.id === next.id ? next : book))
    : [next, ...books];
}

export function patchBook(
  books: LibraryBook[],
  bookId: string,
  patch: Partial<LibraryBook> | ((book: LibraryBook) => LibraryBook),
): LibraryBook[] {
  return books.map((book) =>
    book.id === bookId ? (typeof patch === "function" ? patch(book) : { ...book, ...patch }) : book,
  );
}

export function patchBooks(
  books: LibraryBook[],
  bookIds: Iterable<string>,
  patch: Partial<LibraryBook>,
): LibraryBook[] {
  const ids = new Set(bookIds);
  return books.map((book) => (ids.has(book.id) ? { ...book, ...patch } : book));
}

export function removeBooks(books: LibraryBook[], bookIds: Iterable<string>): LibraryBook[] {
  const ids = new Set(bookIds);
  return books.filter((book) => !ids.has(book.id));
}

export function sortCollections(list: Collection[]): Collection[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}
