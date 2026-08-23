import { useEffect, useState } from "react";
import type { Annotation } from "../../annotations/lib/annotation-types";
import { listAnnotations } from "../../annotations/lib/annotation-db";

/**
 * The marks a READER left in a book — highlights and notes, never `ask`
 * traces.
 *
 * `ask` annotations are the agent runtime's passive record of questions asked
 * in the book's thread (see `ask.recorded` in @read-aware/core). Including them
 * would put the reader's own "look back on this book" prompt into their list of
 * marked passages, and feed it back as a marked passage the next time they
 * asked.
 *
 * Returns `null` until the first load settles, so a caller can tell "not loaded
 * yet" from "nothing marked"; a failed read resolves to an empty list rather
 * than stranding the surface.
 */
export function useBookMarks(bookId: string): Annotation[] | null {
  const [marks, setMarks] = useState<Annotation[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMarks(null);
    void listAnnotations({ bookId })
      .then((list) => {
        if (!cancelled) setMarks(list.filter((entry) => entry.type !== "ask"));
      })
      .catch(() => {
        if (!cancelled) setMarks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  return marks;
}
