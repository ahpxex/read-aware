import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { AppError } from "@read-aware/core";
import { createLogger } from "../../../platform/logger";
import { getReaderPanelLayout, readerPanelLayoutStore, updateReaderPanelLayout, type ReaderPanelLayout } from "../lib/reader-panel-layout";

type BoolUpdater = boolean | ((prev: boolean) => boolean);
const log = createLogger("reader-panel-layout");

/** One live mirror for local writes, external updates and persistence rollback. */
export function useReaderPanelLayout(bookId: string) {
  const raw = useSyncExternalStore(readerPanelLayoutStore.subscribe, readerPanelLayoutStore.getSnapshot);
  const layout = useMemo(() => getReaderPanelLayout(bookId, raw), [bookId, raw]);
  const lifetime = useRef<{ bookId: string; controller: AbortController; revision: number } | null>(null);
  useLayoutEffect(() => {
    const current = { bookId, controller: new AbortController(), revision: 0 };
    lifetime.current = current;
    return () => current.controller.abort(new AppError("reader/superseded", "Reader panel owner retired"));
  }, [bookId]);

  const update = useCallback(async (
    key: keyof ReaderPanelLayout, next: BoolUpdater, exclusive: boolean,
  ): Promise<ReaderPanelLayout | null> => {
    const owner = lifetime.current;
    if (!owner || owner.bookId !== bookId || owner.controller.signal.aborted) return null;
    const revision = ++owner.revision;
    try {
      const result = await updateReaderPanelLayout(bookId, previous => {
        const value = typeof next === "function" ? next(previous[key]) : next;
        const updated = { ...previous, [key]: value };
        if (value && exclusive) updated[key === "tocOpen" ? "notesOpen" : "tocOpen"] = false;
        return updated;
      }, owner.controller.signal);
      // Persist every ordered intent, but only the latest may trigger UI focus.
      return lifetime.current === owner && owner.revision === revision && !owner.controller.signal.aborted ? result : null;
    } catch (error) {
      if (!owner.controller.signal.aborted) {
        // Native write failures already emit the one LocalWriteFailureToasts
        // notice. Keep the exact failure logged without adding a duplicate toast.
        log.warn("Reader panel layout was not saved", error);
      }
      return null;
    }
  }, [bookId]);

  const setTocOpen = useCallback((next: BoolUpdater, exclusive = false) => update("tocOpen", next, exclusive), [update]);
  const setNotesOpen = useCallback((next: BoolUpdater, exclusive = false) => update("notesOpen", next, exclusive), [update]);
  return { tocOpen: layout.tocOpen, notesOpen: layout.notesOpen, setTocOpen, setNotesOpen };
}
