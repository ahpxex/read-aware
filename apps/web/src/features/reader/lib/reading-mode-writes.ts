import { AppError } from "@read-aware/core";

/** Keeps the exact write receipts, including failures that predate index feedback. */
export class ReadingModeWrites {
  private revision = 0;
  private pending = new Set<Promise<void>>();
  private failure: { error: unknown } | undefined;
  private generation = new AbortController();

  constructor(private readonly failed: (revision: number, error: unknown) => void = () => {}) {}

  start(revision: number): void {
    this.generation.abort(new AppError("reader/superseded", "Reading mode persistence was replaced"));
    this.generation = new AbortController();
    this.revision = revision;
    this.pending = new Set();
    this.failure = undefined;
  }

  track(revision: number, write: Promise<void>): void {
    const pending = this.pending;
    if (revision === this.revision) pending.add(write);
    void write.then(() => {
      pending.delete(write);
    }, error => {
      pending.delete(write);
      if (revision === this.revision && !this.failure) {
        this.failure = { error };
        this.failed(revision, error);
      }
    });
  }

  async wait(revision: number, signal?: AbortSignal): Promise<void> {
    const generation = this.generation.signal;
    let reject!: (error: unknown) => void;
    const cancelled = new Promise<never>((_, fail) => { reject = fail; });
    const abort = () => reject(signal?.aborted ? signal.reason : generation.reason);
    generation.addEventListener("abort", abort, { once: true });
    signal?.addEventListener("abort", abort, { once: true });
    // The preflight check can throw before the race starts observing cancellation.
    void cancelled.catch(() => {});
    try {
      // React's remaining effects can register writes after the child's feedback.
      await Promise.resolve();
      while (true) {
        if (revision !== this.revision) throw new AppError("reader/superseded", "Reading mode persistence was replaced");
        if (signal?.aborted) throw signal.reason;
        generation.throwIfAborted();
        if (this.failure) throw this.failure.error;
        const pending = [...this.pending];
        if (!pending.length) return;
        await Promise.race([Promise.allSettled(pending), cancelled]);
      }
    } finally {
      generation.removeEventListener("abort", abort);
      signal?.removeEventListener("abort", abort);
    }
  }
}
