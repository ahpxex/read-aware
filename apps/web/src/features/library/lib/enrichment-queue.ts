import { AppError, errorCode, type BookEnrichmentJob, type EventOrigin } from "@read-aware/core";

export type EnrichmentRequest = { bookId: string; cover: boolean; metadata: boolean; origin?: EventOrigin };
export type EnrichmentOutcome = { reason: BookEnrichmentJob["reason"] };
type Entry = { request: EnrichmentRequest; job: BookEnrichmentJob; done: Promise<BookEnrichmentJob> };
const idle = (): BookEnrichmentJob => ({ phase: "idle", startedAt: null, finishedAt: null, errorCode: null, reason: null });

/** One background parser at a time. Open readers may reuse their already-parsed book immediately. */
export class EnrichmentQueue {
  private entries = new Map<string, Entry>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private run: (request: EnrichmentRequest) => Promise<EnrichmentOutcome>, private report: (error: unknown) => void,
    private now = Date.now) {}

  snapshot(bookId: string): BookEnrichmentJob { return { ...(this.entries.get(bookId)?.job ?? idle()) }; }

  enqueue(request: EnrichmentRequest, work = this.run, alreadyParsed = false): Entry {
    const existing = this.entries.get(request.bookId);
    if (existing && (existing.job.phase === "queued" || existing.job.phase === "running")) {
      if (existing.job.phase === "queued") {
        existing.request.cover ||= request.cover; existing.request.metadata ||= request.metadata;
      }
      return existing;
    }
    this.entries.delete(request.bookId);
    if (this.entries.size >= 256) {
      const oldest = [...this.entries].find(([, entry]) => !["queued", "running"].includes(entry.job.phase));
      if (!oldest) throw new AppError("ui/unavailable", "Enrichment queue is full");
      this.entries.delete(oldest[0]);
    }
    const accepted = { ...request }, job: BookEnrichmentJob = { ...idle(), phase: "queued" };
    const done = (alreadyParsed ? Promise.resolve() : this.tail).then(async () => {
      job.phase = "running"; job.startedAt = this.now();
      try {
        const result = await work(accepted);
        job.reason = result.reason; job.phase = result.reason ? "skipped" : "completed";
      } catch (error) {
        job.phase = "failed"; job.errorCode = errorCode(error) ?? "internal"; this.report(error);
      } finally { job.finishedAt = this.now(); }
      return { ...job };
    });
    const entry = { request: accepted, job, done };
    this.entries.set(request.bookId, entry);
    if (!alreadyParsed) this.tail = done;
    return entry;
  }
}
