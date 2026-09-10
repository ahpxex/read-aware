import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppError } from "@read-aware/core";
import { readingRuntime } from "../../../domain/reading-runtime";
import { readerReferencePreview } from "../../../services/reader-reference-preview";
import type { SelectionOverlayRect } from "../lib/selection-overlay";

type Footnote = { anchorRect: SelectionOverlayRect | null; label: string; text: string; previewId?: string };
type Commit = { id: string; opening: boolean; resolve(): void; reject(error: unknown): void; cleanup(): void };

/** Bridges native clicks and API requests into the same committed React surface. */
export function useReferencePreview(bookId: string | undefined, fallbackLabel: string) {
  const [footnote, setValue] = useState<Footnote | null>(null);
  const [, requestCommit] = useState(0);
  const nativeInterrupt = useRef(() => {});
  const revision = useRef(0);
  const pending = useRef<Commit | null>(null);
  const label = useRef(fallbackLabel); label.current = fallbackLabel;
  const clearCommit = useCallback((error: unknown) => {
    const item = pending.current; pending.current = null;
    if (item) { item.cleanup(); item.reject(error); }
  }, []);
  useLayoutEffect(() => {
    const item = pending.current;
    if (!item) return;
    if ((footnote?.previewId === item.id) === item.opening) {
      pending.current = null; item.cleanup(); item.resolve();
    }
  });
  useEffect(() => {
    let unbind = () => {}, sessionId: string | null = null;
    let alive = true;
    function apply(id: string, opening: boolean, value: Footnote | null, signal?: AbortSignal): Promise<void> {
      if (!alive) return opening ? Promise.reject(new AppError("reader/unavailable", "Preview renderer detached")) : Promise.resolve();
      signal?.throwIfAborted();
      clearCommit(new AppError("reader/superseded", "Preview commit replaced"));
      return new Promise((resolve, reject) => {
        const abort = () => clearCommit(signal?.reason ?? new AppError("reader/timeout", "Preview did not commit"));
        const timer = setTimeout(abort, 10_000);
        pending.current = { id, opening, resolve, reject, cleanup: () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); } };
        signal?.addEventListener("abort", abort, { once: true });
        setValue(previous => opening ? value : previous?.previewId === id ? null : previous);
        requestCommit(value => value + 1);
      });
    }
    const stop = readingRuntime.observe(state => {
      const id = state.status === "ready" && state.bookId === bookId ? state.sessionId : null;
      if (id === sessionId) return;
      unbind(); revision.current++; nativeInterrupt.current = () => {}; sessionId = id;
      clearCommit(new AppError("reader/superseded", "Preview session ended")); setValue(null);
      if (id && bookId) {
        const binding = readerReferencePreview.bind(id, bookId, {
          begin: () => { revision.current++; },
          present: (view, signal) => apply(view.id, true, { previewId: view.id, anchorRect: null,
            label: view.preview.label || label.current,
            text: `${view.preview.offset > 0 ? "..." : ""}${view.preview.text}${view.preview.nextOffset !== null ? "..." : ""}` }, signal),
          clear: id => apply(id, false, null),
        });
        unbind = binding.dispose; nativeInterrupt.current = binding.interrupt;
      }
    });
    return () => { alive = false; revision.current++; stop(); unbind(); nativeInterrupt.current = () => {}; clearCommit(new AppError("reader/superseded", "Preview renderer unmounted")); };
  }, [bookId, clearCommit]);
  const beginNativeFootnote = useCallback(() => {
    nativeInterrupt.current();
    clearCommit(new AppError("reader/superseded", "A native preview intent replaced the request"));
    return ++revision.current;
  }, [clearCommit]);
  const setFootnote = useCallback((value: Footnote | null, expectedRevision?: number) => {
    if (expectedRevision !== undefined && expectedRevision !== revision.current) return;
    beginNativeFootnote();
    setValue(value);
  }, [beginNativeFootnote]);
  const closeFootnote = useCallback(() => setFootnote(null), [setFootnote]);
  return { footnote, setFootnote, closeFootnote, beginNativeFootnote };
}
