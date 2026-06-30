import { useCallback, useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import type { Annotation } from "../lib/annotation-types";
import { listAnnotations, deleteAnnotation } from "../lib/annotation-db";
import { annotationsRevisionAtom } from "../state/annotations-revision";

export function useBookAnnotations(bookId: string | null | undefined) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // Re-read whenever annotations change anywhere (e.g. a mark made in the
  // reader), so this list stays live without a remount.
  const revision = useAtomValue(annotationsRevisionAtom);
  const bumpRevision = useSetAtom(annotationsRevisionAtom);

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
      await deleteAnnotation(id);
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
      bumpRevision((c) => c + 1);
    },
    [bumpRevision],
  );

  return { annotations, isLoading, refresh, remove };
}
