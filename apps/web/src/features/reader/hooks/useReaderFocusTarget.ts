import { useEffect, type RefObject } from "react";
import type { ReaderFocusTarget } from "@read-aware/core";
import { readingRuntime } from "../../../domain/reading-runtime";
import { readerFocus } from "../../../services/reader-focus";
import { focusReaderElement } from "../lib/reader-focus-target";

export function useReaderFocusTarget(bookId: string | undefined, target: ReaderFocusTarget, ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!bookId) return;
    let sessionId: string | null = null;
    let release: (() => void) | undefined;
    const stop = readingRuntime.observe(state => {
      const next = state.status === "ready" && state.bookId === bookId ? state.sessionId : null;
      if (next === sessionId) return;
      release?.(); release = undefined; sessionId = next;
      if (next) release = readerFocus.bind(target, { sessionId: next, bookId, focus: () => focusReaderElement(ref.current) });
    });
    return () => { stop(); release?.(); };
  }, [bookId, target, ref]);
}
