import { useCallback, useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import type { Annotation } from "../lib/annotation-types";
import { listAnnotations } from "../lib/annotation-db";
import { userDomain } from "../../../domain";
import { annotationsRevisionAtom } from "../state/annotations-revision";

export function useBookAnnotations(bookId: string | null | undefined) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
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
    } catch {
      setAnnotations([]);
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
      if (target.type === "highlight") await userDomain.annotations.removeHighlight(id);
      else if (target.type === "note") await userDomain.annotations.removeNote(id);
      else await userDomain.annotations.removeAsk(id);
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
    },
    [annotations],
  );

  return { annotations, isLoading, refresh, remove };
}
