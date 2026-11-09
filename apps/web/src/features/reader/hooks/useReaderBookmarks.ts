import { useEffect, useState } from "react";
import type { Bookmark } from "@read-aware/core";
import { listBookmarks, observeBookmarkInvalidation } from "../../../domain/bookmarks";
import { createLogger } from "../../../platform/logger";

const log = createLogger("reader-bookmarks");

/**
 * The open book's bookmarks, live: local writes, the agent's and ones synced
 * from another device all re-read the list. `bookmarks` stays null until the
 * first read settles; a failed read sets `failed` rather than showing none.
 */
export function useReaderBookmarks(bookId: string): { bookmarks: Bookmark[] | null; failed: boolean } {
  const [state, setState] = useState<{ bookId: string; bookmarks: Bookmark[] | null; failed: boolean }>({
    bookId,
    bookmarks: null,
    failed: false,
  });
  useEffect(() => {
    const lifetime = new AbortController();
    const stop = observeBookmarkInvalidation(async () => {
      try {
        const bookmarks = await listBookmarks(bookId);
        if (!lifetime.signal.aborted) setState({ bookId, bookmarks, failed: false });
      } catch (error) {
        log.error("listing bookmarks failed", error);
        if (!lifetime.signal.aborted)
          setState((previous) => ({
            bookId,
            bookmarks: previous.bookId === bookId ? previous.bookmarks : null,
            failed: true,
          }));
      }
    }, lifetime.signal);
    return () => {
      lifetime.abort();
      stop();
    };
  }, [bookId]);
  return state.bookId === bookId ? state : { bookmarks: null, failed: false };
}
