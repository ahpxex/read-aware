/**
 * BookmarksPort — the agent's view of library bookmarks, over the host
 * bookmarks domain with origin "agent".
 */
import type { BookmarksPort } from "@read-aware/agent";
import { createBookmark, listBookmarks, removeBookmark, renameBookmark } from "../../../../domain/bookmarks";

export function createBookmarksPort(): BookmarksPort {
  return {
    list: (filter) => listBookmarks(filter?.bookId ? String(filter.bookId) : undefined),
    create: (input) => createBookmark({ ...input, bookId: String(input.bookId) }, { origin: "agent" }),
    rename: (bookmark, name) =>
      renameBookmark({ id: String(bookmark.id), bookId: String(bookmark.bookId) }, name, "agent"),
    remove: (bookmark) => removeBookmark({ id: String(bookmark.id), bookId: String(bookmark.bookId) }, "agent"),
  };
}
