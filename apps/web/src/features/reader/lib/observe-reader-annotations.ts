import type { RefObject } from "react";
import { observeBookAnnotations } from "../../../domain/annotations";
import type { Highlight, Note } from "../../annotations/lib/annotation-types";
import { createLogger } from "../../../platform/logger";
import type { FoliateView } from "./foliate-engine";
import { reconcileAnnotationMarks } from "./highlight-renderer";

const log = createLogger("reader-annotations");

export function observeReaderAnnotations(bookId: string, view: FoliateView,
  highlights: RefObject<Highlight[]>, notes: RefObject<Note[]>, changed: (items: Highlight[]) => void): () => void {
  const lifetime = new AbortController();
  const stop = observeBookAnnotations(bookId, async event => {
    const previous = [...highlights.current, ...notes.current];
    const items = event.status === "ready" ? event.result : [];
    highlights.current = items.filter((item): item is Highlight => item.type === "highlight");
    notes.current = items.filter((item): item is Note => item.type === "note");
    changed(highlights.current);
    await reconcileAnnotationMarks(view, previous, [...highlights.current, ...notes.current], lifetime.signal,
      error => log.warn("Could not reconcile stored annotation marker", error));
  }, lifetime.signal);
  return () => { lifetime.abort(); stop(); };
}
