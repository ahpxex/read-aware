import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { Id } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { threadScopeKey } from "../thread-scope";
import { normalizeBookIdParam, resolveBookId } from "./current-book";
import { presentBookStats, presentStatsOverview } from "./format-stats";
import { textResult } from "./tool-result";
import { requestUserInteraction } from "./user-interaction";

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
      "Get active reading time and progress, with durations already formatted for the reader (quote them as given — never invent millisecond numbers). Call it only when the user asks about reading time, streaks, or progress — content questions never need it. With bookId, returns that book; without it, returns the whole-shelf aggregate and every book's stats. bookId defaults to the current book in a book thread, so pass allBooks=true there for the aggregate.",
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
        : (normalizeBookIdParam(bookId) ??
          (scope.kind === "book" ? String(scope.bookId) : undefined));
      if (target) {
        const stats = await deps.library.getBookStats(target as Id);
        if (stats) return textResult(presentBookStats(stats));
        // 书在架上但从未读过 ≠ 未知书：给模型可转述的事实，而不是误导性报错
        const book = await deps.library.getBook(target as Id);
        if (!book) throw new Error(`unknown book: ${target}`);
        return textResult({
          bookId: target,
          status: book.status,
          totalReadingTime: "0m",
          activeDays: 0,
          note: "No reading time has been recorded for this book yet.",
        });
      }
      const [overview, books] = await Promise.all([
        deps.library.getStatsOverview(),
        deps.library.listBookStats(),
      ]);
      return textResult({
        overview: presentStatsOverview(overview),
        books: books.map(presentBookStats),
      });
    },
  };

  const updateBook: AgentTool = {
    name: "update_book",
    label: "Update book",
    description:
      "Update a shelf book when the user explicitly asks: change title/author, star or unstar it, mark it finished or back to reading. Pass only the fields the user asked to change. bookId defaults to the current book.",
    parameters: Type.Object({
      bookId: Type.Optional(Type.String()),
      title: Type.Optional(Type.String({ description: "New title" })),
      author: Type.Optional(Type.String({ description: "New author" })),
      starred: Type.Optional(Type.Boolean({ description: "Add to / remove from favorites" })),
      finished: Type.Optional(
        Type.Boolean({ description: "Mark finished, or false to resume reading" }),
      ),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { bookId, title, author, starred, finished } = params as {
        bookId?: string;
        title?: string;
        author?: string;
        starred?: boolean;
        finished?: boolean;
      };
      if (
        title === undefined &&
        author === undefined &&
        starred === undefined &&
        finished === undefined
      ) {
        throw new Error("pass at least one of title, author, starred, finished");
      }
      const target = resolveBookId(scope, bookId);
      if (!(await deps.library.getBook(target))) throw new Error(`unknown book: ${target}`);
      if (title !== undefined || author !== undefined) {
        await deps.library.editBookMetadata(target, { title, author });
      }
      if (starred !== undefined) await deps.library.setBookStarred(target, starred);
      if (finished !== undefined) await deps.library.setBookFinished(target, finished);
      return textResult({
        updated: true,
        bookId: target,
        ...(title !== undefined ? { title } : {}),
        ...(author !== undefined ? { author } : {}),
        ...(starred !== undefined ? { starred } : {}),
        ...(finished !== undefined ? { finished } : {}),
      });
    },
  };

  const manageCollection: AgentTool = {
    name: "manage_collection",
    label: "Manage collections",
    description:
      "Create, rename, or fill shelf collections. action=create needs name; action=rename needs collectionId + name; action=assign needs bookIds + collectionId (null collectionId removes the books from any collection). Deleting a collection is a separate tool.",
    parameters: Type.Object({
      action: Type.Union(
        [Type.Literal("create"), Type.Literal("rename"), Type.Literal("assign")],
        { description: "Which collection operation to perform" },
      ),
      name: Type.Optional(Type.String({ description: "Collection name (create / rename)" })),
      collectionId: Type.Optional(
        Type.Union([Type.String(), Type.Null()], {
          description: "Target collection (rename / assign); null in assign ungroups the books",
        }),
      ),
      bookIds: Type.Optional(
        Type.Array(Type.String(), { minItems: 1, maxItems: 100, description: "Books to assign" }),
      ),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { action, name: rawName, collectionId, bookIds } = params as {
        action: "create" | "rename" | "assign";
        name?: string;
        collectionId?: string | null;
        bookIds?: string[];
      };
      if (action === "create") {
        const name = rawName?.trim();
        if (!name) throw new Error("create requires a non-empty name");
        return textResult(await deps.library.createCollection(name));
      }
      if (action === "rename") {
        const name = rawName?.trim();
        if (!name) throw new Error("rename requires a non-empty name");
        if (typeof collectionId !== "string") throw new Error("rename requires collectionId");
        const collection = (await deps.library.listCollections()).find(
          (entry) => String(entry.id) === collectionId,
        );
        if (!collection) throw new Error(`unknown collection: ${collectionId}`);
        await deps.library.renameCollection(collectionId, name);
        return textResult({ updated: true, collectionId, name });
      }
      if (!bookIds?.length) throw new Error("assign requires bookIds");
      if (collectionId === undefined) {
        throw new Error("assign requires collectionId (null to ungroup)");
      }
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
    return [getReadingStats, updateBook, deleteBook];
  }

  return [
    listCollections,
    getReadingStats,
    updateBook,
    manageCollection,
    deleteBook,
    deleteCollection,
  ];
}
