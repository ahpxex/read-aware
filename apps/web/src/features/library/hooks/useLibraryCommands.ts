import { useCallback } from "react";
import { useSetAtom } from "jotai";
import { userDomain } from "../../../domain";
import { createLogger } from "../../../platform/logger";
import { deleteBookText } from "../lib/book-text-store";
import type { BookMetadataPatch, Collection, LibraryBook } from "../lib/library-types";
import {
  libraryBooksAtom,
  libraryCollectionsAtom,
  patchBook,
  patchBooks,
  removeBooks,
  sortCollections,
} from "../state/library-store";

const log = createLogger("library");

type LibraryCommandOptions = {
  reportError: (error: unknown) => void;
  /** Full reload — the rollback for optimistic writes that failed. */
  reload: () => Promise<void>;
};

/**
 * User commands on the shelf: star, metadata edits, removal, collections.
 * Each applies optimistically to the store and rolls back (or reloads) when
 * the domain write fails, so the shelf never shows a change that did not stick.
 */
export function useLibraryCommands({ reportError, reload }: LibraryCommandOptions) {
  const setBooks = useSetAtom(libraryBooksAtom);
  const setCollections = useSetAtom(libraryCollectionsAtom);

  const handleCreateCollection = useCallback(
    async (name: string): Promise<Collection | null> => {
      try {
        const collection = await userDomain.library.commands.collections.create(name);
        setCollections((current) => sortCollections([...current, collection]));
        return collection;
      } catch (error) {
        reportError(error);
        return null;
      }
    },
    [reportError, setCollections],
  );

  const handleRenameCollection = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setCollections((current) =>
        sortCollections(current.map((c) => (c.id === id ? { ...c, name: trimmed } : c))),
      );
      void userDomain.library.commands.collections.rename(id, trimmed).catch((error) => {
        void reload();
        reportError(error);
      });
    },
    [reload, reportError, setCollections],
  );

  const handleDeleteCollection = useCallback(
    (id: string) => {
      setCollections((current) => current.filter((c) => c.id !== id));
      setBooks((current) =>
        current.map((book) => (book.collectionId === id ? { ...book, collectionId: null } : book)),
      );
      void userDomain.library.commands.collections.remove(id).catch((error) => {
        void reload();
        reportError(error);
      });
    },
    [reload, reportError, setBooks, setCollections],
  );

  const handleSetBooksCollection = useCallback(
    (ids: string[], collectionId: string | null) => {
      if (ids.length === 0) return;
      setBooks((current) => patchBooks(current, ids, { collectionId }));
      void userDomain.library.commands.collections.assignBooks(ids, collectionId).catch((error) => {
        void reload();
        reportError(error);
      });
    },
    [reload, reportError, setBooks],
  );

  const handleToggleStar = useCallback(
    (book: LibraryBook) => {
      const nextStarred = !book.starred;
      setBooks((current) => patchBook(current, book.id, { starred: nextStarred }));
      void userDomain.library.commands.books.setStarred(book.id, nextStarred).catch((error) => {
        setBooks((current) => patchBook(current, book.id, { starred: book.starred }));
        reportError(error);
      });
    },
    [reportError, setBooks],
  );

  const handleUpdateBookMetadata = useCallback(
    (book: LibraryBook, patch: BookMetadataPatch) => {
      const title = patch.title?.trim() || book.title;
      const author = patch.author?.trim() || book.author;
      if (title === book.title && author === book.author) return;

      setBooks((current) => patchBook(current, book.id, { title, author }));
      void userDomain.library.commands.books.editMetadata(book.id, { title, author }).catch((error) => {
        setBooks((current) => patchBook(current, book.id, { title: book.title, author: book.author }));
        reportError(error);
      });
    },
    [reportError, setBooks],
  );

  const removeBooksById = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const remove =
        ids.length === 1
          ? userDomain.library.commands.books.remove(ids[0]!)
          : userDomain.library.commands.books.removeMany(ids);
      void remove
        .then(() => {
          setBooks((current) => removeBooks(current, ids));
          // Best-effort: a failure strands orphaned full-text rows, not user data.
          void deleteBookText(ids).catch((error: unknown) => {
            log.warn("full-text cleanup failed after book removal", error);
          });
        })
        .catch(reportError);
    },
    [reportError, setBooks],
  );

  const handleRemoveBook = useCallback(
    (book: LibraryBook) => removeBooksById([book.id]),
    [removeBooksById],
  );

  return {
    handleCreateCollection,
    handleRenameCollection,
    handleDeleteCollection,
    handleSetBooksCollection,
    handleToggleStar,
    handleUpdateBookMetadata,
    handleRemoveBook,
    handleRemoveMany: removeBooksById,
  };
}
