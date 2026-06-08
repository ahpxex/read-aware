import { useCallback, useEffect, useState } from "react";
import type { Annotation } from "../lib/annotation-types";
import { listAnnotations, deleteAnnotation } from "../lib/annotation-db";

export function useBookAnnotations(bookId: string | null | undefined) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isLoading, setIsLoading] = useState(false);

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
  }, [refresh]);

  const remove = useCallback(
    async (id: string) => {
      await deleteAnnotation(id);
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
    },
    [],
  );

  return { annotations, isLoading, refresh, remove };
}
