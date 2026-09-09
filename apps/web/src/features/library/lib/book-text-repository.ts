import { AppError, errorCode, type BookTextSnapshot } from "@read-aware/core";
import type { FoliateBook } from "../../reader/lib/foliate-engine";
import { extractBookText } from "./book-text-extraction";
import { parseBookTextRecord, snapshotFromText, textComplete, type BookTextRecord, type ExtractedChapter } from "./book-text-record";

export type TextSource = { contentVersion: string | null; format: string };
export type BookTextDependencies = {
  source(bookId: string, fetchMissing: boolean): Promise<TextSource>;
  read(bookId: string): Promise<unknown>;
  write(record: BookTextRecord): Promise<void>;
  remove(bookId: string): Promise<void>;
  content<T>(bookId: string, version: string, signal: AbortSignal, read: (book: FoliateBook) => Promise<T>): Promise<T>;
  yieldToReader(signal: AbortSignal): Promise<void>;
  warn(message: string, error: unknown): void;
};
type Job = { version: string; controller: AbortController; snapshot: BookTextSnapshot; promise: Promise<ExtractedChapter[]> };

/** Owns extraction, durable verdicts and current-source reads. No independent chapter cache. */
export class BookTextRepository {
  private jobs = new Map<string, Job>();
  private failures = new Map<string, { version: string; code: string }>();
  private writes = new Map<string, Promise<void>>();
  constructor(private readonly deps: BookTextDependencies) {}

  private async source(bookId: string, fetchMissing = false): Promise<TextSource> {
    if (typeof bookId !== "string" || !bookId.trim()) throw new AppError("library/invalid-input", "A book ID is required");
    return this.deps.source(bookId, fetchMissing);
  }
  private async record(bookId: string, version: string): Promise<BookTextRecord | null> {
    return parseBookTextRecord(await this.deps.read(bookId), bookId, version);
  }
  private async checkSource(bookId: string, version: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if ((await this.source(bookId)).contentVersion !== version) throw new AppError("reader/stale-location", "Text source changed during extraction");
    signal?.throwIfAborted();
  }
  private queueWrite(bookId: string, write: () => Promise<void>): Promise<void> {
    const prior = this.writes.get(bookId);
    const task = (prior ?? Promise.resolve()).catch(() => { /* Prior callers receive their own write failure. */ }).then(write);
    this.writes.set(bookId, task);
    void task.finally(() => { if (this.writes.get(bookId) === task) this.writes.delete(bookId); }).catch(() => { /* The returned promise owns this failure. */ });
    return task;
  }

  async snapshot(bookId: string): Promise<BookTextSnapshot> {
    const source = await this.source(bookId);
    const base: BookTextSnapshot = { bookId, contentVersion: source.contentVersion, status: "unprepared", text: "unknown", chapterCount: 0, progress: null };
    if (source.format === "virtual") return { ...base, status: "unsupported" };
    if (!source.contentVersion) return { ...base, status: "unavailable", errorCode: "library/content-unavailable" };
    const job = this.jobs.get(bookId);
    if (job?.version === source.contentVersion) return structuredClone(job.snapshot);
    const record = await this.record(bookId, source.contentVersion);
    await this.checkSource(bookId, source.contentVersion);
    const state = record ? snapshotFromText(record) : base;
    const failure = this.failures.get(bookId);
    if (failure?.version === source.contentVersion) return { ...state, status: state.status === "partial" || state.status === "unsupported" ? state.status : "error", errorCode: failure.code };
    return state;
  }

  async persisted(bookId: string): Promise<ExtractedChapter[] | null> {
    const source = await this.source(bookId);
    if (!source.contentVersion || source.format === "virtual") return null;
    const record = await this.record(bookId, source.contentVersion);
    await this.checkSource(bookId, source.contentVersion);
    return record && textComplete(record) ? record.chapters : null;
  }

  async ensure(bookId: string, waitForPdf = false): Promise<ExtractedChapter[]> {
    const source = await this.source(bookId, true);
    if (source.format === "virtual") return [];
    const version = source.contentVersion;
    if (!version) throw new AppError("library/content-unavailable", "Book source is unavailable");
    const prior = await this.record(bookId, version);
    await this.checkSource(bookId, version);
    if (prior && textComplete(prior)) {
      this.failures.delete(bookId);
      return prior.chapters;
    }
    let job = this.jobs.get(bookId);
    if (job && job.version !== version) {
      job.controller.abort(new AppError("reader/stale-location", "Text source changed"));
      job = undefined;
    }
    if (!job) {
      // Install before asynchronous extraction, so callers share one parser.
      const controller = new AbortController();
      const next: Job = { version, controller,
        snapshot: { bookId, contentVersion: version, status: "preparing", text: "unknown", chapterCount: 0, progress: null },
        promise: Promise.resolve([]) };
      this.jobs.set(bookId, next); this.failures.delete(bookId);
      const signal = controller.signal;
      const current = async () => {
        signal.throwIfAborted();
        if (this.jobs.get(bookId) !== next) throw new AppError("reader/stale-location", "Text extraction was replaced");
        await this.checkSource(bookId, version, signal);
      };
      next.promise = (async () => {
        await current();
        const result = await this.deps.content(bookId, version, signal, book => extractBookText(book, {
          bookId, contentVersion: version, prior, signal,
          yieldToReader: () => this.deps.yieldToReader(signal),
          save: record => this.queueWrite(bookId, async () => { await current(); await this.deps.write(record); await current(); }),
          progress: snapshot => { if (!signal.aborted) next.snapshot = { ...snapshot, status: "preparing", chapterCount: 0 }; },
          warn: this.deps.warn,
        }));
        await current();
        if (!textComplete(result)) throw new AppError(result.failures[0]?.code ?? (result.unsupported.length || !result.required.length ? "library/text-unsupported" : "library/text-extraction-failed"), "Book text extraction did not read every required section", { retryable: result.failures.length > 0 });
        return result.chapters;
      })().catch(error => {
        if (this.jobs.get(bookId) === next && !signal.aborted) this.failures.set(bookId, { version, code: errorCode(error) ?? "library/text-extraction-failed" });
        this.deps.warn("Book text extraction failed", error); throw error;
      }).finally(() => { if (this.jobs.get(bookId) === next) this.jobs.delete(bookId); });
      job = next;
    }
    if (source.format === "pdf" && !waitForPdf) {
      // The job records/logs failures; this cold query deliberately does not wait.
      void job.promise.catch(() => {});
      return [];
    }
    return job.promise;
  }

  async remove(bookId: string): Promise<void> {
    this.jobs.get(bookId)?.controller.abort(new AppError("library/book-not-found", "Book was removed"));
    this.jobs.delete(bookId); this.failures.delete(bookId);
    await this.queueWrite(bookId, () => this.deps.remove(bookId));
  }
}
