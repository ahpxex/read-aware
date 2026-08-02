import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { Id } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { threadScopeKey } from "../thread-scope";
import { textResult } from "./tool-result";
import { requestUserInteraction } from "./user-interaction";

function resolveBookId(scope: ThreadScope, raw?: string): Id {
  const target = (raw ?? (scope.kind === "book" ? scope.bookId : undefined)) as Id | undefined;
  if (!target) throw new Error("bookId is required in the global thread");
  return target;
}

export function buildShelfTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const listCollections: AgentTool = {
    name: "list_collections",
    label: "List collections",
    description:
      "List the user's shelf collections and the book ids currently assigned to each one.",
    parameters: Type.Object({}),
    execute: async () => {
      const collections = await deps.library.listCollections();
      const memberships = await Promise.all(
        collections.map(async (collection) => ({
          ...collection,
          bookIds: await deps.library.booksInCollection(String(collection.id)),
        })),
      );
      return textResult(memberships);
    },
  };

  const getReadingStats: AgentTool = {
    name: "get_reading_stats",
    label: "Reading stats",
    description:
      "Get active reading time and progress. With bookId, returns that book; without it, returns the whole-shelf aggregate and every book's stats. bookId defaults to the current book in a book thread, so pass allBooks=true there for the aggregate.",
    parameters: Type.Object({
      bookId: Type.Optional(Type.String()),
      allBooks: Type.Optional(
        Type.Boolean({ description: "Return the whole-shelf aggregate even in a book thread" }),
      ),
    }),
    execute: async (_id, params) => {
      const { bookId, allBooks = false } = params as { bookId?: string; allBooks?: boolean };
      const target = allBooks
        ? undefined
        : (bookId ?? (scope.kind === "book" ? String(scope.bookId) : undefined));
      if (target) {
        const stats = await deps.library.getBookStats(target as Id);
        if (!stats) throw new Error(`unknown book: ${target}`);
        return textResult(stats);
      }
      const [overview, books] = await Promise.all([
        deps.library.getStatsOverview(),
        deps.library.listBookStats(),
      ]);
      return textResult({ overview, books });
    },
  };

  const editBookMetadata: AgentTool = {
    name: "edit_book_metadata",
    label: "Edit book metadata",
    description:
      "Change a book's title and/or author when the user explicitly asks. bookId defaults to the current book.",
    parameters: Type.Object({
      bookId: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      author: Type.Optional(Type.String()),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { bookId, title, author } = params as {
        bookId?: string;
        title?: string;
        author?: string;
      };
      if (title === undefined && author === undefined) {
        throw new Error("title or author is required");
      }
      const target = resolveBookId(scope, bookId);
      if (!(await deps.library.getBook(target))) throw new Error(`unknown book: ${target}`);
      await deps.library.editBookMetadata(target, { title, author });
      return textResult({ updated: true, bookId: target, title, author });
    },
  };

  const setBookStarred: AgentTool = {
    name: "set_book_starred",
    label: "Update favorite",
    description:
      "Add or remove a book from favorites when the user asks. bookId defaults to the current book.",
    parameters: Type.Object({
      starred: Type.Boolean(),
      bookId: Type.Optional(Type.String()),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { bookId, starred } = params as { bookId?: string; starred: boolean };
      const target = resolveBookId(scope, bookId);
      if (!(await deps.library.getBook(target))) throw new Error(`unknown book: ${target}`);
      await deps.library.setBookStarred(target, starred);
      return textResult({ updated: true, bookId: target, starred });
    },
  };

  const setBookFinished: AgentTool = {
    name: "set_book_finished",
    label: "Update reading status",
    description:
      "Mark a book finished or undo that explicit verdict when the user asks. bookId defaults to the current book.",
    parameters: Type.Object({
      finished: Type.Boolean(),
      bookId: Type.Optional(Type.String()),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { bookId, finished } = params as { bookId?: string; finished: boolean };
      const target = resolveBookId(scope, bookId);
      if (!(await deps.library.getBook(target))) throw new Error(`unknown book: ${target}`);
      await deps.library.setBookFinished(target, finished);
      return textResult({ updated: true, bookId: target, finished });
    },
  };

  const createCollection: AgentTool = {
    name: "create_collection",
    label: "Create collection",
    description: "Create a shelf collection with the name the user requested.",
    parameters: Type.Object({ name: Type.String() }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const name = (params as { name: string }).name.trim();
      if (!name) throw new Error("collection name must not be empty");
      return textResult(await deps.library.createCollection(name));
    },
  };

  const renameCollection: AgentTool = {
    name: "rename_collection",
    label: "Rename collection",
    description: "Rename an existing shelf collection when the target is unambiguous.",
    parameters: Type.Object({
      collectionId: Type.String(),
      name: Type.String(),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { collectionId, name: rawName } = params as { collectionId: string; name: string };
      const name = rawName.trim();
      if (!name) throw new Error("collection name must not be empty");
      const collection = (await deps.library.listCollections()).find(
        (entry) => String(entry.id) === collectionId,
      );
      if (!collection) throw new Error(`unknown collection: ${collectionId}`);
      await deps.library.renameCollection(collectionId, name);
      return textResult({ updated: true, collectionId, name });
    },
  };

  const assignBooks: AgentTool = {
    name: "assign_books_to_collection",
    label: "Organize books",
    description:
      "Assign one or more books to a shelf collection. Pass collectionId=null to remove them from any collection.",
    parameters: Type.Object({
      bookIds: Type.Array(Type.String(), { minItems: 1, maxItems: 100 }),
      collectionId: Type.Union([Type.String(), Type.Null()]),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { bookIds, collectionId } = params as {
        bookIds: string[];
        collectionId: string | null;
      };
      const uniqueBookIds = [...new Set(bookIds)] as Id[];
      const knownBooks = new Set((await deps.library.listBooks()).map((book) => String(book.id)));
      const unknown = uniqueBookIds.filter((bookId) => !knownBooks.has(String(bookId)));
      if (unknown.length) throw new Error(`unknown book(s): ${unknown.join(", ")}`);
      if (
        collectionId !== null &&
        !(await deps.library.listCollections()).some(
          (collection) => String(collection.id) === collectionId,
        )
      ) {
        throw new Error(`unknown collection: ${collectionId}`);
      }
      await deps.library.assignBooksToCollection(uniqueBookIds, collectionId);
      return textResult({ updated: true, bookIds: uniqueBookIds, collectionId });
    },
  };

  const deleteBook: AgentTool = {
    name: "delete_book",
    label: "Delete book",
    description:
      "Permanently remove a book and its imported source file. The host ALWAYS asks the user for permission before deletion; never ask separately or claim success before this tool returns. bookId defaults to the current book.",
    parameters: Type.Object({ bookId: Type.Optional(Type.String()) }),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal, onUpdate) => {
      const target = resolveBookId(scope, (params as { bookId?: string }).bookId);
      const book = await deps.library.getBook(target);
      if (!book) throw new Error(`unknown book: ${target}`);
      const { answer, details } = await requestUserInteraction({
        deps,
        toolCallId,
        threadKey: threadScopeKey(scope),
        request: { kind: "permission", action: "delete-book", subject: book.title },
        signal,
        onUpdate,
      });
      const approved = !answer.cancelled && answer.optionId === "approve";
      if (!approved) return { ...textResult({ deleted: false, reason: "User declined." }), details };
      await deps.library.removeBook(target);
      return { ...textResult({ deleted: true, bookId: target, title: book.title }), details };
    },
  };

  const deleteCollection: AgentTool = {
    name: "delete_collection",
    label: "Delete collection",
    description:
      "Delete a shelf collection; its books stay on the shelf ungrouped. The host ALWAYS asks the user for permission before deletion.",
    parameters: Type.Object({ collectionId: Type.String() }),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal, onUpdate) => {
      const { collectionId } = params as { collectionId: string };
      const collection = (await deps.library.listCollections()).find(
        (entry) => String(entry.id) === collectionId,
      );
      if (!collection) throw new Error(`unknown collection: ${collectionId}`);
      const { answer, details } = await requestUserInteraction({
        deps,
        toolCallId,
        threadKey: threadScopeKey(scope),
        request: {
          kind: "permission",
          action: "delete-collection",
          subject: collection.name,
        },
        signal,
        onUpdate,
      });
      const approved = !answer.cancelled && answer.optionId === "approve";
      if (!approved) return { ...textResult({ deleted: false, reason: "User declined." }), details };
      await deps.library.removeCollection(collectionId);
      return { ...textResult({ deleted: true, collectionId }), details };
    },
  };

  if (scope.kind === "book") {
    return [
      getReadingStats,
      editBookMetadata,
      setBookStarred,
      setBookFinished,
      deleteBook,
    ];
  }

  return [
    listCollections,
    getReadingStats,
    editBookMetadata,
    setBookStarred,
    setBookFinished,
    createCollection,
    renameCollection,
    assignBooks,
    deleteBook,
    deleteCollection,
  ];
}
