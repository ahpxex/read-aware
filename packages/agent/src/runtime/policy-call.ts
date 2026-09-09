/** A live policy revokes an operation permanently, even if later re-enabled. */
export interface LivePolicy {
  enabled(): boolean;
  subscribe(listener: () => void): () => void;
}

export function policyCall(policy: LivePolicy, denied: () => Error, signal?: AbortSignal) {
  const controller = new AbortController();
  const check = () => { if (!policy.enabled()) controller.abort(denied()); };
  const abort = () => controller.abort(signal?.reason);
  const unsubscribe = policy.subscribe(check);
  signal?.addEventListener("abort", abort, { once: true });
  check();
  if (signal?.aborted) abort();
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener("abort", onAbort, { once: true });
  if (controller.signal.aborted) onAbort();
  // Preflight can reject before the caller attaches its first operation.
  void aborted.catch(() => {});
  let disposed = false;
  return {
    signal: controller.signal,
    assertAllowed() { check(); controller.signal.throwIfAborted(); },
    wait<T>(operation: Promise<T>): Promise<T> { return Promise.race([operation, aborted]); },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      signal?.removeEventListener("abort", abort);
      controller.signal.removeEventListener("abort", onAbort);
    },
  };
}
