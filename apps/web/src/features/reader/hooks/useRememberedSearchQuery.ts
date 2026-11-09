import { useEffect, useRef, useState } from "react";
import { createLogger } from "../../../platform/logger";
import { readSearchQuery, writeSearchQuery } from "../lib/book-search-memory";

const log = createLogger("reader-search");

/** Typing settles for this long before the query is stored. */
const SETTLE_MS = 400;

function remember(bookId: string, query: string): void {
  writeSearchQuery(bookId, query).catch((error: unknown) =>
    // The store has already rolled the value back and reported the failure.
    log.warn("Could not remember the book search", error),
  );
}

/**
 * The book search field's text, starting from the last query searched in
 * this book on this device (see lib/book-search-memory). It is stored once
 * typing settles, and on unmount if the latest text was not stored yet.
 */
export function useRememberedSearchQuery(bookId: string): [string, (query: string) => void] {
  const [state, setState] = useState(() => ({ bookId, query: readSearchQuery(bookId) }));
  const query = state.bookId === bookId ? state.query : readSearchQuery(bookId);
  const setQuery = (next: string) => setState({ bookId, query: next });

  // What still has to be stored, if anything.
  const unsaved = useRef<{ bookId: string; query: string } | null>(null);
  useEffect(() => {
    if (state.bookId !== bookId) return;
    unsaved.current = { bookId, query: state.query.trim() };
    const timer = window.setTimeout(() => {
      const pending = unsaved.current;
      unsaved.current = null;
      if (pending) remember(pending.bookId, pending.query);
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [bookId, state]);
  // Leaving (or switching books) stores what typing had not settled yet.
  useEffect(
    () => () => {
      const pending = unsaved.current;
      unsaved.current = null;
      if (pending) remember(pending.bookId, pending.query);
    },
    [bookId],
  );

  return [query, setQuery];
}
