import type { RefObject } from "react";
import { observeBookAnnotations } from "../../../domain/annotations";
import type { Annotation, Highlight, Note } from "../../annotations/lib/annotation-types";
import { createLogger } from "../../../platform/logger";
import type { FoliateView } from "./foliate-engine";
import { reconcileAnnotationMarks } from "./highlight-renderer";

const log = createLogger("reader-annotations");

export type ReaderAnnotationMarks = {
  dispose(): void;
  /** Show a row the store returned for this reader's own write without waiting
   *  for the observer to re-read the whole book. The observer stays the
   *  authority: its next snapshot finds the mark already drawn, or removes it. */
  adopt(annotation: Annotation): void;
};

/** The marks one reader session shows for a book: each snapshot, or an adopted
 *  stored row, replaces the session's lists and repaints only what changed. */
export function createReaderAnnotationMarks(
  bookId: string,
  view: Pick<FoliateView, "addAnnotation" | "deleteAnnotation">,
  highlights: RefObject<Highlight[]>,
  notes: RefObject<Note[]>,
  changed: (items: Highlight[]) => void,
) {
  const lifetime = new AbortController();
  const show = (items: Annotation[]) => {
    const previous = [...highlights.current, ...notes.current];
    highlights.current = items.filter((item): item is Highlight => item.type === "highlight");
    notes.current = items.filter((item): item is Note => item.type === "note");
    changed(highlights.current);
    return reconcileAnnotationMarks(
      view,
      previous,
      [...highlights.current, ...notes.current],
      lifetime.signal,
      (error) => log.warn("Could not reconcile stored annotation marker", error),
    );
  };
  return {
    show,
    adopt: (annotation: Annotation) => {
      if (lifetime.signal.aborted || annotation.bookId !== bookId) return Promise.resolve();
      if (annotation.type !== "highlight" && annotation.type !== "note") return Promise.resolve();
      const current = [...highlights.current, ...notes.current];
      return show([annotation, ...current.filter((item) => item.id !== annotation.id)]);
    },
    lifetime,
  };
}

export function observeReaderAnnotations(
  bookId: string,
  view: FoliateView,
  highlights: RefObject<Highlight[]>,
  notes: RefObject<Note[]>,
  changed: (items: Highlight[]) => void,
): ReaderAnnotationMarks {
  const marks = createReaderAnnotationMarks(bookId, view, highlights, notes, changed);
  const stop = observeBookAnnotations(
    bookId,
    (event) => marks.show(event.status === "ready" ? event.result : []),
    marks.lifetime.signal,
  );
  return {
    dispose: () => {
      marks.lifetime.abort();
      stop();
    },
    adopt: (annotation) => {
      void marks.adopt(annotation);
    },
  };
}
