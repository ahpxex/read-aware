import { AppError, errorCode, type BookTextRange, type ReadingEmphasisStyle } from "@read-aware/core";
import type { EmphasisPresentation, ReadingEmphasisAdapter } from "../../../domain/reading-emphasis-controller";
import { readBookRange } from "../../library/lib/book-range";
import { loadContentNavigation, loadDrawFns, type FoliateOverlayer, type FoliateView } from "./foliate-engine";
import { renderedBookRange } from "./rendered-book-range";
import { createLogger } from "../../../platform/logger";

type Mark = { ranges: BookTextRange[]; style: ReadingEmphasisStyle; attached: Array<{ overlayer: FoliateOverlayer; key: string }>; state: EmphasisPresentation };
const log = createLogger("reading-emphasis-renderer");

export async function createReadingEmphasisAdapter(view: FoliateView): Promise<ReadingEmphasisAdapter> {
  const draw = await loadDrawFns(), { resolveTextQuote } = await loadContentNavigation();
  const marks = new Map<string, Mark>(), observers = new Set<(id: string, state: EmphasisPresentation) => void>();
  let retired = false, queued = false;
  const remove = (attached: Mark["attached"]) => { for (const mark of attached) mark.overlayer.remove(mark.key); };
  const paint = (id: string, ranges: BookTextRange[], style: ReadingEmphasisStyle): Mark => {
    const targets = ranges.map(range => renderedBookRange(view, range, resolveTextQuote));
    const attached: Mark["attached"] = [];
    try {
      for (const target of targets) {
        if (!target?.content.overlayer) continue;
        const overlayer = target.content.overlayer, key = `readaware-emphasis:${id}:${crypto.randomUUID()}`;
        // Null hit identity leaves links, persisted annotations and guided units
        // beneath temporary marks interactive. This is never a user annotation.
        overlayer.add(key, target.range, (rects, options) => {
          const element = draw[style](rects, options);
          element.setAttribute("data-reading-emphasis", id);
          return element;
        }, { color: "#0f766e", width: 2, writingMode: getComputedStyle(target.content.doc.documentElement).writingMode }, null);
        attached.push({ overlayer, key });
      }
    } catch (error) { remove(attached); throw error; }
    return { ranges, style, attached, state: { attached: attached.length,
      status: attached.length === ranges.length ? "attached" : attached.length ? "partial" : "deferred" } };
  };
  const refresh = () => {
    if (retired || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false; if (retired) return;
      for (const [id, previous] of marks) {
        let next: Mark;
        try { next = paint(id, previous.ranges, previous.style); }
        catch (error) {
          next = { ...previous, attached: [], state: { attached: 0, status: "error", errorCode: errorCode(error) ?? "reader/render-failed" } };
          if (previous.state.status !== "error" || previous.state.errorCode !== next.state.errorCode) log.warn("Could not reattach temporary emphasis", error);
        }
        remove(previous.attached); marks.set(id, next);
        if (JSON.stringify(previous.state) !== JSON.stringify(next.state)) for (const observer of observers) observer(id, next.state);
      }
    });
  };
  for (const event of ["load", "create-overlay", "relocate"]) view.addEventListener(event, refresh);
  return {
    validate: async (ranges, signal) => {
      for (const range of ranges) { signal.throwIfAborted(); await readBookRange({ range, limit: 2, contextChars: 0 }, signal); }
    },
    put: (id, ranges, style) => {
      if (retired) throw new AppError("reader/superseded", "Emphasis renderer retired");
      const next = paint(id, ranges, style), previous = marks.get(id);
      if (previous) remove(previous.attached);
      marks.set(id, next); return next.state;
    },
    remove: id => { const previous = marks.get(id); if (previous) remove(previous.attached); marks.delete(id); },
    observe: handler => { observers.add(handler); return () => { observers.delete(handler); }; },
    retire: () => {
      if (retired) return; retired = true;
      for (const event of ["load", "create-overlay", "relocate"]) view.removeEventListener(event, refresh);
      for (const mark of marks.values()) remove(mark.attached);
      marks.clear(); observers.clear();
    },
  };
}
