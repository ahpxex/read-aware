import { useEffect, useRef } from "react";
import type { LibraryBook } from "../../library";
import { standbyCandidate } from "../lib/standby-candidate";

/** How long the shelf may stay busy before the standing book is made ready anyway. */
const STANDBY_IDLE_TIMEOUT_MS = 6000;

/**
 * While the shelf is showing and the reader holds no book, make the likeliest
 * next one ready in it (see `standbyCandidate` and the reading session's
 * `standbyBook`). The work waits for the main thread to go idle: it is as
 * much as opening the book, and the shelf it runs behind must stay smooth.
 */
export function useReaderStandby({
  enabled,
  holding,
  books,
  standbyBook,
}: {
  /** The library is loaded, the shelf is showing and nothing is being read or changing hands. */
  enabled: boolean;
  /** The book the reader already holds, if any. */
  holding: string | null;
  books: readonly LibraryBook[];
  standbyBook: (book: LibraryBook) => void;
}): void {
  const tried = useRef(new Set<string>());
  const latest = useRef({ books, standbyBook });
  useEffect(() => {
    latest.current = { books, standbyBook };
  });
  const wanted = enabled && !holding;
  useEffect(() => {
    if (!wanted) return;
    const start = () => {
      const candidate = standbyCandidate(latest.current.books, tried.current);
      if (!candidate) return;
      tried.current.add(candidate.id);
      latest.current.standbyBook(candidate);
    };
    // WKWebView has no requestIdleCallback: a pause after the shelf settles stands in for it.
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(start, { timeout: STANDBY_IDLE_TIMEOUT_MS });
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(start, 1500);
    return () => window.clearTimeout(timer);
  }, [wanted]);
}
