import { AppError, errorCode, normalizeAnnotationObservation, type AnnotationObservation, type AnnotationObservationQuery, type AnnotationObservationResult } from "@read-aware/core";

/** Settled projection reads also observe sync/rebuild changes that have no local domain broadcast. */
export class AnnotationObserver {
  private count = 0;
  constructor(private readonly deps: { schedule(work: () => void): () => void; report(error: unknown): void }) {}

  observe(input: AnnotationObservationQuery, read: (query: AnnotationObservationQuery) => Promise<AnnotationObservationResult>,
    handler: (event: AnnotationObservation) => unknown, lifetime?: AbortSignal): () => void {
    const query = normalizeAnnotationObservation(input);
    if (typeof handler !== "function") throw new AppError("annotations/invalid-input", "Expected an observation callback");
    if (lifetime?.aborted) throw new AppError("annotations/cancelled", "Annotation observer owner retired");
    if (this.count >= 64) throw new AppError("annotations/observer-limit", "Too many annotation observers");
    ++this.count;
    let disposed = false, revision = 0, settled: string | undefined, cancelTimer: (() => void) | undefined;
    const dispose = () => {
      if (disposed) return;
      disposed = true; --this.count; cancelTimer?.(); cancelTimer = undefined;
      lifetime?.removeEventListener("abort", dispose);
    };
    const poll = async () => {
      let value: Omit<Extract<AnnotationObservation, { status: "ready" }>, "revision"> | Omit<Extract<AnnotationObservation, { status: "error" }>, "revision">;
      try { value = { status: "ready", result: await read(structuredClone(query)) }; }
      catch (error) { this.deps.report(error); value = { status: "error", errorCode: errorCode(error) ?? "annotations/observation-failed" }; }
      if (disposed) return;
      const key = JSON.stringify(value);
      if (key !== settled) {
        try { await handler({ ...structuredClone(value), revision: ++revision }); settled = key; }
        catch (error) { this.deps.report(error); }
      }
      // Wait for the callback too: slow Workers cannot accumulate reads or deliveries.
      if (!disposed) cancelTimer = this.deps.schedule(() => { cancelTimer = undefined; void poll(); });
    };
    lifetime?.addEventListener("abort", dispose, { once: true });
    void poll();
    return dispose;
  }
}
