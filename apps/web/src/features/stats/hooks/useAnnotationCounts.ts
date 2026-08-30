import { useCallback, useEffect, useState } from "react";
import { userDomain } from "../../../domain";
import { createLogger } from "../../../platform/logger";

/** Note + highlight tallies for a single book. */
export type BookAnnotationCounts = {
  notes: number;
  highlights: number;
  total: number;
};

export type AnnotationCounts = {
  notes: number;
  highlights: number;
  total: number;
  byBook: Map<string, BookAnnotationCounts>;
  isLoading: boolean;
  /** The read failed — the zeros above are absence of data, not data. */
  loadFailed: boolean;
  refresh: () => Promise<void>;
};

const EMPTY: BookAnnotationCounts = { notes: 0, highlights: 0, total: 0 };

/**
 * Library-wide note/highlight counts, loaded once on mount from the annotations
 * store. Annotations only change inside the reader, which unmounts the library
 * shell (and this hook with it); returning to the shelf remounts and reloads, so
 * the counts stay fresh without a reactive store. Only notes and highlights are
 * tallied; any legacy `ai-chat` records still in storage are skipped.
 */
const log = createLogger("stats");

export function useAnnotationCounts(): AnnotationCounts {
  const [counts, setCounts] = useState<Omit<AnnotationCounts, "isLoading" | "loadFailed" | "refresh">>({
    notes: 0,
    highlights: 0,
    total: 0,
    byBook: new Map(),
  });
  const [isLoading, setIsLoading] = useState(true);
  /** Failed reads must not render as a plausible all-zero stats page. */
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const all = await userDomain.annotations.queries.list();
      const byBook = new Map<string, BookAnnotationCounts>();
      let notes = 0;
      let highlights = 0;
      for (const annotation of all) {
        if (annotation.kind !== "note" && annotation.kind !== "highlight") continue;
        const prev = byBook.get(annotation.bookId) ?? { ...EMPTY };
        if (annotation.kind === "note") {
          prev.notes += 1;
          notes += 1;
        } else {
          prev.highlights += 1;
          highlights += 1;
        }
        prev.total += 1;
        byBook.set(annotation.bookId, prev);
      }
      setCounts({ notes, highlights, total: notes + highlights, byBook });
      setLoadFailed(false);
    } catch (error) {
      log.error("listing annotation counts failed", error);
      setCounts({ notes: 0, highlights: 0, total: 0, byBook: new Map() });
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...counts, isLoading, loadFailed, refresh };
}
