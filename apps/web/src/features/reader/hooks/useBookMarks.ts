import { useEffect, useState } from "react";
import type { Annotation } from "../../annotations/lib/annotation-types";
import { listAnnotations } from "../../annotations/lib/annotation-db";
import { createLogger } from "../../../platform/logger";

const log = createLogger("reader");

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
 * `marks` stays `null` until the first load settles, so a caller can tell
 * "not loaded yet" from "nothing marked"; a failed read sets `failed` instead
 * of masquerading as an empty list.
 */
export function useBookMarks(bookId: string): { marks: Annotation[] | null; failed: boolean } {
  const [marks, setMarks] = useState<Annotation[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMarks(null);
    setFailed(false);
    void listAnnotations({ bookId })
      .then((list) => {
        if (!cancelled) setMarks(list.filter((entry) => entry.type !== "ask"));
      })
      .catch((error) => {
        log.error("listing book marks failed", error);
        if (!cancelled) {
          setMarks([]);
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  return { marks, failed };
}
