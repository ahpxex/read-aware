import { AppError, validateClassificationBookId } from "@read-aware/core";

type Job = { start(): Promise<void>; cancel(): void };
type Lane = { running: boolean; waiting: Job[] };

/** One local host queue for all production graph upkeep passes. */
export class BookDigestQueue {
  private readonly lanes = new Map<string, Lane>();
  private size = 0;

  run<T>(bookId: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    validateClassificationBookId(bookId);
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.size >= 64) return Promise.reject(new AppError("memory/task-limit", "Too many queued or active graph passes", { retryable: true }));
    const lane = this.lanes.get(bookId) ?? { running: false, waiting: [] };
    this.lanes.set(bookId, lane); this.size++;
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        cancel: () => {
          const index = lane.waiting.indexOf(job);
          if (index < 0) return;
          lane.waiting.splice(index, 1); this.size--; signal?.removeEventListener("abort", job.cancel);
          if (!lane.running && !lane.waiting.length) this.lanes.delete(bookId);
          reject(signal?.reason);
        },
        start: async () => {
          signal?.removeEventListener("abort", job.cancel);
          try { signal?.throwIfAborted(); resolve(await work()); }
          catch (error) { reject(error); }
          finally {
            this.size--; lane.running = false;
            this.advance(bookId, lane);
          }
        },
      };
      lane.waiting.push(job); signal?.addEventListener("abort", job.cancel, { once: true });
      this.advance(bookId, lane);
    });
  }

  private advance(bookId: string, lane: Lane) {
    if (lane.running) return;
    const next = lane.waiting.shift();
    if (!next) { this.lanes.delete(bookId); return; }
    lane.running = true;
    void next.start();
  }
}
