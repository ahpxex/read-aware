import { AppError, type BookTextRange } from "@read-aware/core";
import type { ReadingSelectionAdapter } from "../../../domain/reading-session-controller";
import { readBookRange } from "../../library/lib/book-range";
import { loadContentNavigation, type FoliateView } from "./foliate-engine";
import type { SelectionRenderBarrier } from "./selection-render-barrier";
import type { ReaderSelectionState } from "./selection-overlay";
import { renderedBookRange } from "./rendered-book-range";

export function createReadingSelectionAdapter(view: FoliateView, current: () => ReaderSelectionState | null,
  capture: (doc: Document, index: number) => boolean, clear: () => void, render: SelectionRenderBarrier): ReadingSelectionAdapter {
  let retired = false;
  const check = (expectedId: string | null, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (retired || (current()?.captured?.id ?? null) !== expectedId) throw new AppError("reader/superseded", "Selection changed before presentation");
  };
  return {
    validate: async (range, signal) => { await readBookRange({ range, limit: 2, contextChars: 0 }, signal); },
    select: async (target: BookTextRange, expectedId, signal) => {
      const { resolveTextQuote } = await loadContentNavigation();
      check(expectedId, signal);
      const resolved = renderedBookRange(view, target, resolveTextQuote);
      if (!resolved) throw new AppError("reader/target-not-found", "Selection target is not rendered");
      const { content: { doc, index }, range: anchor } = resolved;
      const selection = doc.defaultView?.getSelection() ?? doc.getSelection();
      if (!selection) throw new AppError("reader/unavailable", "Document selection is unavailable");
      check(expectedId, signal);
      selection.removeAllRanges(); selection.addRange(anchor);
      if (!capture(doc, index)) throw new AppError("reader/target-not-found", "Selection has no visible overlay");
      const state = current();
      if (!state?.captured?.range) throw new AppError("reader/target-not-found", "Selection did not produce a source range");
      await render.wait(state, signal);
      check(state.captured.id, signal);
      return structuredClone(state.captured);
    },
    clear: async (expectedId, signal) => {
      check(expectedId, signal); clear(); await render.wait(null, signal); check(null, signal);
    },
    retire: () => { retired = true; render.retire(); },
  };
}
