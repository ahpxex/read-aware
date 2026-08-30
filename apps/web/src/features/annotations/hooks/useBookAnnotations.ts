import { useCallback, useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import type { Annotation } from "../lib/annotation-types";
import { listAnnotations } from "../lib/annotation-db";
import { userDomain } from "../../../domain";
import { createLogger } from "../../../platform/logger";
import { annotationsRevisionAtom } from "../state/annotations-revision";

const log = createLogger("annotations");

export function useBookAnnotations(bookId: string | null | undefined) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  /** A failed READ must not masquerade as "no annotations" — surfaces render
   *  an error state (with refresh as the retry) instead of an empty list. */
  const [loadFailed, setLoadFailed] = useState(false);
  // Re-read whenever annotations change anywhere (e.g. a mark made in the
  // reader), so this list stays live without a remount.
  const revision = useAtomValue(annotationsRevisionAtom);

  const refresh = useCallback(async () => {
    if (!bookId) {
      setAnnotations([]);
      return;
    }
    setIsLoading(true);
    try {
      const results = await listAnnotations({ bookId });
      setAnnotations(results);
      setLoadFailed(false);
    } catch (error) {
      log.error("listing annotations failed", error);
      setAnnotations([]);
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    void refresh();
  }, [refresh, revision]);

  const remove = useCallback(
    async (id: string) => {
      const target = annotations.find((a) => a.id === id);
      if (!target) return;
      // Domain commands own the revision bump and the origin stamp.
      if (target.type === "highlight") {
        await userDomain.annotations.commands.removeHighlight(id);
      } else if (target.type === "note") {
        await userDomain.annotations.commands.removeNote(id);
      } else {
        await userDomain.annotations.commands.removeAsk(id);
      }
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
    },
    [annotations],
  );

  return { annotations, isLoading, loadFailed, refresh, remove };
}
