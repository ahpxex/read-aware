import { AppError, errorCode, normalizeReadingTimeQuery, type ReadingTimeQuery, type ReadingTimeSnapshot, type ReadingTimeObservation } from "@read-aware/core";

/** Pull observations never queue behind a slow consumer or overlap native reads. */
export class ReadingTimeObserver {
  private count = 0;
  constructor(private readonly deps: {
    read(query: ReadingTimeQuery): Promise<ReadingTimeSnapshot>;
    schedule(callback: () => void): () => void;
    report(error: unknown): void;
  }) {}

  observe(query: ReadingTimeQuery, handler: (event: ReadingTimeObservation) => unknown): () => void {
    const accepted = normalizeReadingTimeQuery(query);
    if (this.count >= 64) throw new AppError("reading/stats-observer-limit", "Too many reading time observers");
    ++this.count;
    let disposed = false, revision = 0, cancelTimer: (() => void) | undefined;
    const poll = async () => {
      let event: ReadingTimeObservation;
      try { event = { revision: ++revision, status: "ready", snapshot: await this.deps.read(accepted) }; }
      catch (error) {
        this.deps.report(error);
        event = { revision, status: "error", errorCode: errorCode(error) ?? "reading/stats-unavailable" };
      }
      if (disposed) return;
      try { await handler(event); } catch (error) { this.deps.report(error); }
      if (!disposed) cancelTimer = this.deps.schedule(() => { cancelTimer = undefined; void poll(); });
    };
    void poll();
    return () => {
      if (disposed) return;
      disposed = true; --this.count; cancelTimer?.(); cancelTimer = undefined;
    };
  }
}
