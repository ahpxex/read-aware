import { useCallback, useEffect, useState } from "react";
import { errorCode } from "@read-aware/core";
import type { Annotation } from "../lib/annotation-types";
import { changeObservedAnnotation } from "../lib/native-annotation-mutations";
import { observeAllAnnotations, observeBookAnnotations } from "../../../domain/annotations";
import { createLogger } from "../../../platform/logger";

const log = createLogger("annotations");
type Scope = { kind: "all" } | { kind: "book"; bookId: string };
type Snapshot = { scopeKey: string | null; annotations: Annotation[]; isLoading: boolean; loadFailed: boolean; loadErrorCode?: string };
const empty = { annotations: [] as Annotation[], isLoading: false, loadFailed: false, loadErrorCode: undefined };

export function useAnnotations(scope: Scope | null) {
  const kind = scope?.kind;
  const bookId = scope?.kind === "book" ? scope.bookId : undefined;
  const scopeKey = kind ? JSON.stringify([kind, bookId]) : null;
  const [snapshot, setSnapshot] = useState<Snapshot>({ scopeKey: null, ...empty });
  const [request, setRequest] = useState(0);
  const refresh = useCallback(() => setRequest(value => value + 1), []);
  useEffect(() => {
    if (!kind) { setSnapshot({ scopeKey: null, ...empty }); return; }
    const lifetime = new AbortController();
    setSnapshot({ scopeKey, ...empty, isLoading: true });
    const onChange: Parameters<typeof observeAllAnnotations>[0] = event => {
      setSnapshot({ scopeKey, annotations: event.status === "ready" ? event.result : [],
        isLoading: false, loadFailed: event.status === "error", loadErrorCode: event.status === "error" ? event.errorCode : undefined });
    };
    try {
      if (kind === "all") observeAllAnnotations(onChange, lifetime.signal);
      else observeBookAnnotations(bookId!, onChange, lifetime.signal);
    } catch (error) {
      log.error("observing annotations failed", error);
      setSnapshot({ scopeKey, ...empty, loadFailed: true, loadErrorCode: errorCode(error) ?? "annotations/observation-failed" });
    }
    return () => lifetime.abort();
  }, [kind, bookId, scopeKey, request]);
  // A changed/closed scope must not paint the preceding collection before effects run.
  const current = snapshot.scopeKey === scopeKey ? snapshot : { ...empty, isLoading: !!kind };
  const remove = useCallback(async (id: string) => {
    const target = current.annotations.find(annotation => annotation.id === id);
    if (target) await changeObservedAnnotation(target, { op: "remove" });
    // Observation alone owns collection updates, including late completion races.
  }, [current.annotations]);
  return { ...current, refresh, remove };
}
