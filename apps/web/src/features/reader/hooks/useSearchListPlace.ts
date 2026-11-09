import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { VirtualRowsHandle } from "@read-aware/ui";
import { bookSearchSession } from "./useContentsSearch";

/**
 * Where the book search's result list was left, for this run of the app: the
 * list reopens at the row that was at its top, if it still shows the same
 * query. Rows are found by key, so a mark or bookmark added since (which
 * shifts the rows below it) does not move the place. Returns the list's
 * scroll handler.
 */
export function useSearchListPlace(
  bookId: string,
  query: string,
  rowsRef: RefObject<VirtualRowsHandle | null>,
): () => void {
  // Only the list as it opens is restored; later queries start at the top.
  const [opening] = useState(() => bookSearchSession.place.get(bookId, query));
  useEffect(() => {
    const row = opening;
    if (!row) return;
    // The rows mount a commit after the list does (VirtualRows measures its
    // scroller first), so reach for the row a frame later.
    const frame = window.requestAnimationFrame(() => rowsRef.current?.scrollToKey(row, "start"));
    return () => window.cancelAnimationFrame(frame);
  }, [opening, rowsRef]);

  const latest = useRef({ bookId, query });
  useLayoutEffect(() => {
    latest.current = { bookId, query };
  });
  return useCallback(() => {
    const row = rowsRef.current?.topRowKey();
    if (row) bookSearchSession.place.set(latest.current.bookId, latest.current.query, row);
  }, [rowsRef]);
}
