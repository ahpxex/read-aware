import { useCallback, useEffect, useRef, useState } from "react";
import {
  getReaderPanelLayout,
  saveReaderPanelLayout,
  type ReaderPanelLayout,
} from "../lib/reader-panel-layout";

type BoolUpdater = boolean | ((prev: boolean) => boolean);

/**
 * Per-book open state for the contents and notes panels. Seeds from storage on
 * mount (the shell remounts per book) and writes back on every change, so a book
 * reopens with the panels exactly as they were left. The setters mirror
 * `useState` dispatchers (value or updater function).
 */
export function useReaderPanelLayout(bookId: string) {
  const [layout, setLayout] = useState<ReaderPanelLayout>(() =>
    getReaderPanelLayout(bookId),
  );

  // Keep the latest layout reachable synchronously so the setters can derive the
  // next value (and persist it) without putting side effects in a state updater.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Reload if the book changes without a remount (e.g. opening another book from
  // the in-reader search); the initializer already covered the first book.
  const loadedBookRef = useRef(bookId);
  useEffect(() => {
    if (loadedBookRef.current === bookId) return;
    loadedBookRef.current = bookId;
    setLayout(getReaderPanelLayout(bookId));
  }, [bookId]);

  const update = useCallback(
    (key: "tocOpen" | "notesOpen", next: BoolUpdater) => {
      const prev = layoutRef.current;
      const value = typeof next === "function" ? next(prev[key]) : next;
      if (value === prev[key]) return;
      const updated = { ...prev, [key]: value };
      layoutRef.current = updated;
      saveReaderPanelLayout(bookId, updated);
      setLayout(updated);
    },
    [bookId],
  );

  const setTocOpen = useCallback((next: BoolUpdater) => update("tocOpen", next), [update]);
  const setNotesOpen = useCallback((next: BoolUpdater) => update("notesOpen", next), [update]);

  return {
    tocOpen: layout.tocOpen,
    notesOpen: layout.notesOpen,
    setTocOpen,
    setNotesOpen,
  };
}
