/**
 * Library bookmarks — named places in a book the reader wants to return to.
 * Bookmarks are the reader's own data (events, synced), separate from
 * annotations: a bookmark holds a reading target and a name, never book text.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { AppError, bookmarkLocation, bookmarkTargetFrom, type Bookmark, type BookmarkKind } from "@read-aware/core";
import { bool, int, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { threadScopeKey } from "../thread-scope";
import { normalizeBookIdParam } from "./current-book";
import { textResult } from "./tool-result";
import { requestUserInteraction } from "./user-interaction";

const LIST_LIMIT = 50;

function summary(bookmark: Bookmark) {
  return {
    id: bookmark.id,
    bookId: bookmark.bookId,
    name: bookmark.name,
    kind: bookmark.kind,
    createdAt: bookmark.createdAt,
  };
}

async function findBookmark(deps: RuntimeDeps, id: string): Promise<Bookmark> {
  const bookmark = (await deps.bookmarks.list()).find((entry) => entry.id === id);
  if (!bookmark) throw new AppError("bookmarks/not-found", `bookmark not found: ${id}`);
  return bookmark;
}

export function buildBookmarkTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const listBookmarks: AgentTool = {
    name: "list_bookmarks",
    label: "List bookmarks",
    description:
      "List the reader's bookmarks (named reading positions), oldest first. In a book thread it defaults to the current book; pass bookId for another book, or allBooks=true for the whole library. query filters by a case-insensitive substring of the name. Returns ids for manage_bookmark, not book text.",
    parameters: obj({
      bookId: opt(str()),
      allBooks: opt(bool()),
      query: opt(str({ maxLength: 200 })),
      limit: opt(int({ minimum: 1, maximum: LIST_LIMIT })),
    }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const { bookId, allBooks, query, limit } = params as {
        bookId?: string;
        allBooks?: boolean;
        query?: string;
        limit?: number;
      };
      const explicit = normalizeBookIdParam(bookId);
      const target = explicit ?? (allBooks === true || scope.kind === "global" ? undefined : scope.bookId);
      const needle = query?.trim().toLocaleLowerCase();
      const matches = (await deps.bookmarks.list(target ? { bookId: target } : undefined)).filter(
        (bookmark) => !needle || bookmark.name.toLocaleLowerCase().includes(needle),
      );
      const max = limit ?? 20;
      return textResult({
        bookId: target ?? null,
        bookmarks: matches.slice(0, max).map(summary),
        total: matches.length,
        truncated: matches.length > max,
      });
    },
  };

  const saveBookmark: AgentTool = {
    name: "save_bookmark",
    label: "Save bookmark",
    description:
      "Bookmark the reader's current position (kind=location) or current text selection (kind=selection) in the open book, when the reader asks. name defaults to the selected text or the book title; pass the name the reader asked for. Captures the live reader state: it fails when no book is open, or for kind=selection when nothing is selected. Does not navigate or create an annotation.",
    parameters: obj({
      kind: oneOf(["location", "selection"], { description: "Current page position, or the selected passage" }),
      name: opt(str({ maxLength: 120 })),
    }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const { kind, name } = params as { kind: BookmarkKind; name?: string };
      const session = await deps.reader.getSession();
      if (session.status !== "ready" || !session.bookId || !session.location)
        throw new AppError("reader/no-session", "Open a book before saving a bookmark");
      if (scope.kind === "book" && session.bookId !== scope.bookId)
        throw new AppError("reader/stale-location", "The reader is showing another book than this thread's");
      const source = kind === "selection" ? session.selection?.range : session.location;
      if (!source) throw new AppError("bookmarks/invalid-input", "Nothing is selected in the reader");
      const target = bookmarkTargetFrom({ ...source, bookId: session.bookId }, kind);
      const book = await deps.library.getBook(session.bookId);
      const fallback =
        (kind === "selection" ? session.selection?.text.replace(/\s+/gu, " ").trim().slice(0, 120) : "") ||
        book?.title.trim().slice(0, 120) ||
        session.bookId;
      signal?.throwIfAborted();
      const bookmark = await deps.bookmarks.create({
        bookId: session.bookId,
        name: name?.trim() || fallback,
        kind,
        target,
      });
      return textResult({ saved: true, bookmark: summary(bookmark) });
    },
  };

  const manageBookmark: AgentTool = {
    name: "manage_bookmark",
    label: "Manage bookmark",
    description:
      "Open, rename or delete one bookmark by the id list_bookmarks returned. open navigates the reader to it (opening its book when needed) and never guesses a replacement when the book's content changed. rename requires name. delete removes only the bookmark — the host ALWAYS asks the reader for permission first.",
    parameters: obj({
      action: oneOf(["open", "rename", "delete"]),
      bookmarkId: str(),
      name: opt(str({ maxLength: 120 })),
    }),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal, onUpdate) => {
      signal?.throwIfAborted();
      const { action, bookmarkId, name } = params as {
        action: "open" | "rename" | "delete";
        bookmarkId: string;
        name?: string;
      };
      const bookmark = await findBookmark(deps, bookmarkId);
      if (action === "open") {
        await deps.reader.goTo(bookmarkLocation(bookmark), signal);
        return textResult({ opened: true, bookmark: summary(bookmark) });
      }
      if (action === "rename") {
        if (!name?.trim()) throw new AppError("bookmarks/invalid-input", "rename requires a name");
        await deps.bookmarks.rename(bookmark, name);
        return textResult({ renamed: true, bookmarkId, name: name.trim() });
      }
      const { answer, details } = await requestUserInteraction({
        deps,
        toolCallId,
        threadKey: threadScopeKey(scope),
        request: { kind: "permission", action: "delete-bookmark", subject: bookmark.name },
        signal,
        onUpdate,
      });
      if (answer.cancelled || answer.optionId !== "approve")
        return { ...textResult({ deleted: false, reason: "User declined." }), details };
      await deps.bookmarks.remove(bookmark);
      return { ...textResult({ deleted: true, bookmarkId }), details };
    },
  };

  return [listBookmarks, saveBookmark, manageBookmark];
}
