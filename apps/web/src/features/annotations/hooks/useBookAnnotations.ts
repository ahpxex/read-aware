import { useCallback, useEffect, useState } from "react";
import { errorCode } from "@read-aware/core";
import type { Annotation } from "../lib/annotation-types";
import { changeObservedAnnotation } from "../lib/native-annotation-mutations";
import { observeBookAnnotations } from "../../../domain/annotations";
import { createLogger } from "../../../platform/logger";

const log = createLogger("annotations");

export function useBookAnnotations(bookId: string | null | undefined) {
  const [snapshot, setSnapshot] = useState<{ bookId: string | null; annotations: Annotation[]; isLoading: boolean; loadFailed: boolean; loadErrorCode?: string }>(
    { bookId: null, annotations: [], isLoading: false, loadFailed: false },
  );
  const [request, setRequest] = useState(0);
  const refresh = useCallback(() => setRequest(value => value + 1), []);
  useEffect(() => {
    if (!bookId) {
      setSnapshot({ bookId: null, annotations: [], isLoading: false, loadFailed: false });
      return;
    }
    const lifetime = new AbortController();
    setSnapshot({ bookId, annotations: [], isLoading: true, loadFailed: false });
    try {
      observeBookAnnotations(bookId, event => {
        setSnapshot({ bookId, annotations: event.status === "ready" ? event.result : [],
          isLoading: false, loadFailed: event.status === "error", loadErrorCode: event.status === "error" ? event.errorCode : undefined });
      }, lifetime.signal);
    } catch (error) {
      log.error("observing annotations failed", error);
      setSnapshot({ bookId, annotations: [], isLoading: false, loadFailed: true, loadErrorCode: errorCode(error) ?? "annotations/observation-failed" });
    }
    return () => lifetime.abort();
  }, [bookId, request]);
  // Never display the preceding book while the new effect is being installed.
  const { annotations, isLoading, loadFailed, loadErrorCode } = snapshot.bookId === bookId ? snapshot
    : { annotations: [] as Annotation[], isLoading: !!bookId, loadFailed: false, loadErrorCode: undefined };

  const remove = useCallback(
    async (id: string) => {
      const target = annotations.find((a) => a.id === id);
      if (!target) return;
      await changeObservedAnnotation(target, { op: "remove" });
    },
    [annotations, bookId],
  );

  return { annotations, isLoading, loadFailed, loadErrorCode, refresh, remove };
}
