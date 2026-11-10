import {
  AppError,
  errorCode,
  assertOperationConditions,
  type OperationCondition,
  type BookTextPriority,
  type BookTextWaitReason,
  type BookTextSnapshot,
} from "@read-aware/core";
import type { ChapterMap, FoliateBook } from "../../reader/lib/foliate-engine";
import { extractBookText } from "./book-text-extraction";
import {
  parseBookTextRecord,
  snapshotFromText,
  storedNavigationOf,
  textComplete,
  type BookTextRecord,
  type ExtractedChapter,
  type StoredNavigation,
} from "./book-text-record";

import { BookTextScheduler } from "./book-text-scheduler";
import {
  actorFromEvent,
  causalActor,
  mergeEventCauses,
  stampEventCause,
  type DomainActor,
} from "../../../platform/domain-actor";

export type TextSource = { contentVersion: string | null; format: string; revision?: string; available?: boolean };
export type BookTextDependencies = {
  retrievalConditions?(signal?: AbortSignal): Promise<OperationCondition[]>;
  source(bookId: string, fetchMissing: boolean): Promise<TextSource>;
  read(bookId: string): Promise<unknown>;
  write(record: BookTextRecord): Promise<void>;
  remove(bookId: string): Promise<void>;
  /**
   * A small copy of the navigation stored with a book's complete text (see
   * `StoredNavigation`), so opening the book does not read its whole text to
   * learn it. `keep(bookId, null)` forgets the copy. Without this the record
   * is read every time.
   */
  navigation?: {
    kept(bookId: string): StoredNavigation | null;
    keep(bookId: string, navigation: StoredNavigation | null): void;
  };
  /** The parsed book with its repaired TOC, and that book's chapter map. */
  content<T>(
    bookId: string,
    version: string,
    signal: AbortSignal,
    read: (book: FoliateBook, chapters: ChapterMap) => Promise<T>,
  ): Promise<T>;
  yieldToReader(signal: AbortSignal, waiting?: (value: boolean) => void): Promise<void>;
  warn(message: string, error: unknown): void;
  changed?(bookId: string, origin: DomainActor): void;
};
type PreparedText = { chapters: ExtractedChapter[]; state: BookTextSnapshot };
export type TextPreparationOptions = {
  /** Host-only request identity; never serialized into extracted text. */
  origin?: DomainActor;
  cancellationOrigin?(): DomainActor | undefined;
  /** Wait for physical cleanup when this request cancels the last shared lease. */
  drainOnCancel?: boolean;
  rebuild?: boolean;
  priority?(): BookTextPriority;
  scheduling?(reason: BookTextWaitReason): void;
  signal?: AbortSignal;
  progress?(snapshot: BookTextSnapshot): void;
  /** Internal request checkpoint: reset completed, so a resumed rebuild must not erase new progress. */
  onRebuildReset?(): void;
};
type Job = {
  cause: object;
  version: string;
  sourceRevision?: string;
  controller: AbortController;
  snapshot: BookTextSnapshot;
  promise: Promise<PreparedText>;
  settled: boolean;
  waitReason: BookTextWaitReason;
  consumers: Map<symbol, TextPreparationOptions>;
};

/** Owns extraction, durable verdicts and current-source reads. No independent chapter cache. */
export class BookTextRepository {
  private jobs = new Map<string, Job>();
  private failures = new Map<string, { version: string; sourceRevision?: string; code: string }>();
  private writes = new Map<string, Promise<void>>();
  /**
   * The last complete record read. A finished extraction is fixed for its
   * content version, while every durable read costs the whole text over IPC
   * plus a main-thread JSON parse — and the graph catch-up asks once per
   * chapter. Partial records are never kept (extraction resumes from them);
   * any write or removal through this repository drops the entry first.
   */
  private completeRecord: BookTextRecord | null = null;
  private readonly scheduler: BookTextScheduler;
  constructor(private readonly deps: BookTextDependencies) {
    this.scheduler = new BookTextScheduler(deps.yieldToReader);
  }
  private changed(bookId: string, origin: DomainActor): void {
    try {
      this.deps.changed?.(bookId, origin);
    } catch (error) {
      this.deps.warn("Text availability observer failed", error);
    }
  }

  private async source(bookId: string, fetchMissing = false): Promise<TextSource> {
    if (typeof bookId !== "string" || !bookId.trim())
      throw new AppError("library/invalid-input", "A book ID is required");
    return this.deps.source(bookId, fetchMissing);
  }
  private async record(bookId: string, version: string): Promise<BookTextRecord | null> {
    const cached = this.completeRecord;
    if (cached?.bookId === bookId && cached.contentVersion === version) return cached;
    const record = parseBookTextRecord(await this.deps.read(bookId), bookId, version);
    if (record && textComplete(record) && !this.writes.has(bookId)) this.completeRecord = record;
    return record;
  }
  private async checkSource(
    bookId: string,
    version: string | null,
    signal?: AbortSignal,
    revision?: string,
  ): Promise<void> {
    signal?.throwIfAborted();
    const source = await this.source(bookId);
    if (source.contentVersion !== version || source.revision !== revision)
      throw new AppError("reader/stale-location", "Text source changed during extraction");
    signal?.throwIfAborted();
  }
  private queueWrite(bookId: string, write: () => Promise<void>): Promise<void> {
    if (this.completeRecord?.bookId === bookId) this.completeRecord = null;
    const prior = this.writes.get(bookId);
    const task = (prior ?? Promise.resolve())
      .catch(() => {
        /* Prior callers receive their own write failure. */
      })
      .then(write);
    this.writes.set(bookId, task);
    void task
      .finally(() => {
        if (this.writes.get(bookId) === task) this.writes.delete(bookId);
      })
      .catch(() => {
        /* The returned promise owns this failure. */
      });
    return task;
  }

  async snapshot(bookId: string): Promise<BookTextSnapshot> {
    const source = await this.source(bookId);
    const base: BookTextSnapshot = {
      bookId,
      contentVersion: source.contentVersion,
      status: "unprepared",
      text: "unknown",
      chapterCount: 0,
      progress: null,
    };
    if (source.format === "virtual" && !source.contentVersion && source.available) return base;
    if (!source.contentVersion) return { ...base, status: "unavailable", errorCode: "library/content-unavailable" };
    const job = this.jobs.get(bookId);
    if (job?.version === source.contentVersion && job.sourceRevision === source.revision)
      return structuredClone(job.snapshot);
    const record = await this.record(bookId, source.contentVersion);
    await this.checkSource(bookId, source.contentVersion, undefined, source.revision);
    const state = record ? snapshotFromText(record) : base;
    const failure = this.failures.get(bookId);
    if (failure?.version === source.contentVersion && failure.sourceRevision === source.revision)
      return {
        ...state,
        status: state.status === "partial" || state.status === "unsupported" ? state.status : "error",
        errorCode: failure.code,
      };
    return state;
  }

  async persisted(bookId: string): Promise<ExtractedChapter[] | null> {
    const source = await this.source(bookId);
    if (!source.contentVersion) return null;
    const record = await this.record(bookId, source.contentVersion);
    await this.checkSource(bookId, source.contentVersion, undefined, source.revision);
    if (this.jobs.has(bookId)) return null;
    return record && textComplete(record) ? record.chapters : null;
  }

  /**
   * Navigation stored with the book's complete text (repaired, rebuilt or
   * recovered), for the next opening. Answered from the kept copy when it
   * belongs to this source; otherwise from the record, whose copy is then
   * kept (a library from before the copy existed fills in book by book).
   */
  async persistedNavigation(bookId: string): Promise<NonNullable<BookTextRecord["outline"]> | null> {
    const source = await this.source(bookId);
    if (!source.contentVersion) return null;
    // A write in flight may be replacing what the copy was made from.
    if (!this.writes.has(bookId)) {
      const kept = this.keptNavigation(bookId);
      if (kept?.contentVersion === source.contentVersion) return kept.outline;
    }
    const record = await this.record(bookId, source.contentVersion);
    await this.checkSource(bookId, source.contentVersion, undefined, source.revision);
    const navigation = record && !this.writes.has(bookId) ? storedNavigationOf(record) : null;
    if (navigation) this.keepNavigation(bookId, navigation);
    return record && textComplete(record) ? (record.outline ?? null) : null;
  }

  private keptNavigation(bookId: string): StoredNavigation | null {
    try {
      return this.deps.navigation?.kept(bookId) ?? null;
    } catch (error) {
      this.deps.warn("Kept book navigation unavailable", error);
      return null;
    }
  }
  /** The copy is a convenience: failing to keep it costs the next opening a record read, nothing else. */
  private keepNavigation(bookId: string, navigation: StoredNavigation | null): void {
    try {
      this.deps.navigation?.keep(bookId, navigation);
    } catch (error) {
      this.deps.warn("Keeping book navigation failed", error);
    }
  }

  async ensure(bookId: string, waitForPdf = false, origin?: DomainActor): Promise<ExtractedChapter[]> {
    return (await this.request(bookId, waitForPdf, { origin })).chapters;
  }

  async chapter(
    bookId: string,
    index: number,
    version: string,
    signal?: AbortSignal,
    origin?: DomainActor,
  ): Promise<ExtractedChapter | undefined> {
    const result = await this.request(bookId, true, { signal, origin });
    if (result.state.contentVersion !== version)
      throw new AppError("memory/conflict", "Chapter text belongs to another source");
    const chapter = result.chapters[index];
    if (chapter && chapter.text.length > 2 * 1024 * 1024)
      throw new AppError("memory/input-budget-exceeded", "Digest chapter exceeds its read budget");
    return chapter;
  }

  async prepare(bookId: string, options: TextPreparationOptions = {}): Promise<BookTextSnapshot> {
    const result = await this.request(bookId, true, options);
    if (result.state.status !== "ready")
      throw new AppError("library/text-unsupported", "Derived text preparation is unsupported");
    return result.state;
  }

  private preparationSourceConditions(source: TextSource, rebuild: boolean, busy: boolean): OperationCondition[] {
    if (rebuild && busy)
      return [{ kind: "capacity", state: "unavailable", reason: "text-rebuild-busy", errorCode: "library/text-busy" }];
    if (source.format === "virtual" && !source.available && !source.contentVersion)
      return [
        {
          kind: "provider",
          state: "unavailable",
          reason: "book-content-provider-unavailable",
          errorCode: "library/content-unavailable",
        },
      ];
    return [
      {
        kind: "object",
        state: source.contentVersion ? "satisfied" : "unknown",
        reason: source.contentVersion ? "source-version-known" : "source-content-not-loaded",
      },
      {
        kind: "provider",
        state: "unknown",
        reason: source.format === "virtual" ? "book-content-load-not-checked" : "text-extraction-not-checked",
      },
    ];
  }

  /** No parser/provider invocation or missing-file retrieval. */
  async preparationConditions(bookId: string, rebuild = false, signal?: AbortSignal): Promise<OperationCondition[]> {
    signal?.throwIfAborted();
    const source = await this.source(bookId);
    signal?.throwIfAborted();
    const job = this.jobs.get(bookId);
    const busy = !!job && job.version === source.contentVersion && job.sourceRevision === source.revision;
    const conditions = this.preparationSourceConditions(source, rebuild, busy);
    if (!source.contentVersion && source.format !== "virtual")
      conditions.push(
        ...((await this.deps.retrievalConditions?.(signal)) ?? [
          {
            kind: "provider" as const,
            state: "unknown" as const,
            reason: "source-retrieval-prerequisites-unavailable",
          },
        ]),
      );
    await this.checkSource(bookId, source.contentVersion, signal, source.revision);
    signal?.throwIfAborted();
    return conditions;
  }

  private notify(job: Job): void {
    for (const notify of job.consumers.values()) {
      try {
        notify.progress?.(structuredClone(job.snapshot));
      } catch (error) {
        this.deps.warn("Text preparation observer failed", error);
      }
    }
  }

  /** A cancelled request releases its lease, not another reader's work. */
  private join(bookId: string, job: Job, options: TextPreparationOptions): Promise<PreparedText> {
    const token = Symbol();
    job.cause = mergeEventCauses([job.cause, stampEventCause({}, options.origin)], {});
    job.consumers.set(token, options);
    return new Promise((resolve, reject) => {
      let finished = false;
      const release = () => {
        options.signal?.removeEventListener("abort", abort);
        job.consumers.delete(token);
        if (!job.settled && !job.consumers.size) {
          const cancelledBy = options.cancellationOrigin?.() ?? options.origin;
          job.cause = mergeEventCauses([job.cause, stampEventCause({}, cancelledBy)], {});
          job.controller.abort(new AppError("library/text-cancelled", "No text preparation consumers remain"));
          if (this.jobs.get(bookId) === job) {
            this.jobs.delete(bookId);
            this.changed(bookId, actorFromEvent(job.cause));
          }
        }
      };
      const abort = () => {
        if (finished) return;
        finished = true;
        release();
        const reason = options.signal?.reason ?? new AppError("library/text-cancelled", "Text request cancelled");
        if (options.drainOnCancel && !job.consumers.size)
          void job.promise.then(
            () => reject(reason),
            () => reject(reason),
          );
        else reject(reason);
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      // Always attach to the shared promise, even if this caller already cancelled.
      void job.promise.then(
        (value) => {
          if (finished) return;
          finished = true;
          release();
          resolve(value);
        },
        (error) => {
          if (finished) return;
          finished = true;
          release();
          reject(error);
        },
      );
      if (options.signal?.aborted) abort();
      else {
        try {
          options.progress?.(structuredClone(job.snapshot));
          options.scheduling?.(job.waitReason);
        } catch (error) {
          this.deps.warn("Text preparation observer failed", error);
        }
      }
    });
  }

  private async request(bookId: string, waitForPdf: boolean, options: TextPreparationOptions): Promise<PreparedText> {
    options = { ...options, origin: causalActor(options.origin ?? "system") };
    options.signal?.throwIfAborted();
    assertOperationConditions(await this.preparationConditions(bookId, options.rebuild, options.signal));
    const source = await this.source(bookId, true);
    options.signal?.throwIfAborted();
    const version = source.contentVersion;
    if (!version) throw new AppError("library/content-unavailable", "Book source is unavailable");
    const prior = await this.record(bookId, version);
    await this.checkSource(bookId, version, undefined, source.revision);
    options.signal?.throwIfAborted();
    let job = this.jobs.get(bookId);
    if (job && (job.version !== version || job.sourceRevision !== source.revision)) {
      job.controller.abort(new AppError("reader/stale-location", "Text source changed"));
      job = undefined;
    }
    assertOperationConditions(this.preparationSourceConditions(source, options.rebuild === true, !!job));
    if (!job && !options.rebuild && prior && textComplete(prior)) {
      this.failures.delete(bookId);
      return { chapters: prior.chapters, state: snapshotFromText(prior) };
    }
    if (!job) {
      // Install before asynchronous extraction, so callers share one parser.
      const controller = new AbortController();
      const next: Job = {
        cause: stampEventCause({}, options.origin),
        version,
        sourceRevision: source.revision,
        controller,
        snapshot: {
          bookId,
          contentVersion: version,
          status: "preparing",
          text: "unknown",
          chapterCount: 0,
          progress: null,
        },
        settled: false,
        waitReason: null,
        consumers: new Map(),
        promise: Promise.resolve({
          chapters: [],
          state: {
            bookId,
            contentVersion: version,
            status: "preparing",
            text: "unknown",
            chapterCount: 0,
            progress: null,
          },
        }),
      };
      this.jobs.set(bookId, next);
      this.failures.delete(bookId);
      this.changed(bookId, actorFromEvent(next.cause));
      const signal = controller.signal;
      const current = async () => {
        signal.throwIfAborted();
        if (this.jobs.get(bookId) !== next) throw new AppError("reader/stale-location", "Text extraction was replaced");
        await this.checkSource(bookId, version, signal, source.revision);
      };
      next.promise = (async () => {
        await current();
        if (options.rebuild)
          await this.queueWrite(bookId, async () => {
            await current();
            this.keepNavigation(bookId, null);
            await this.deps.remove(bookId);
            options.onRebuildReset?.();
            await current();
          });
        const result = await this.deps.content(bookId, version, signal, (book, chapters) =>
          extractBookText(book, {
            bookId,
            contentVersion: version,
            prior: options.rebuild ? null : prior,
            chapters,
            signal,
            yieldToReader: async () => {},
            readSection: (read) =>
              this.scheduler.read(
                signal,
                () =>
                  [...next.consumers.values()].some((consumer) => (consumer.priority?.() ?? "normal") === "normal")
                    ? "normal"
                    : "background",
                (reason) => {
                  if (next.waitReason === reason) return;
                  next.waitReason = reason;
                  for (const consumer of next.consumers.values()) {
                    try {
                      consumer.scheduling?.(reason);
                    } catch (error) {
                      this.deps.warn("Text scheduling observer failed", error);
                    }
                  }
                },
                read,
              ),
            save: (record) =>
              this.queueWrite(bookId, async () => {
                await current();
                // Forgotten before the record changes, kept again once the
                // complete one is stored: the copy never outlives its record.
                this.keepNavigation(bookId, null);
                await this.deps.write(record);
                this.keepNavigation(bookId, storedNavigationOf(record));
                await current();
              }),
            progress: (snapshot) => {
              if (!signal.aborted) {
                next.snapshot = { ...snapshot, status: "preparing", chapterCount: 0 };
                this.notify(next);
              }
            },
            warn: this.deps.warn,
          }),
        );
        await current();
        if (!textComplete(result))
          throw new AppError(
            result.failures[0]?.code ??
              (result.unsupported.length || !result.required.length
                ? "library/text-unsupported"
                : "library/text-extraction-failed"),
            "Book text extraction did not read every required section",
            { retryable: result.failures.length > 0 },
          );
        return { chapters: result.chapters, state: snapshotFromText(result) };
      })()
        .catch((error) => {
          if (this.jobs.get(bookId) === next && !signal.aborted)
            this.failures.set(bookId, {
              version,
              sourceRevision: source.revision,
              code: errorCode(error) ?? "library/text-extraction-failed",
            });
          if (!signal.aborted) this.deps.warn("Book text extraction failed", error);
          throw error;
        })
        .finally(() => {
          next.settled = true;
          if (this.jobs.get(bookId) === next) {
            this.jobs.delete(bookId);
            this.changed(bookId, actorFromEvent(next.cause));
          }
        });
      job = next;
    }
    const pending = this.join(bookId, job, options);
    if (source.format === "pdf" && !waitForPdf) {
      // The job records/logs failures; this cold query deliberately does not wait.
      void pending.catch(() => {});
      return { chapters: [], state: structuredClone(job.snapshot) };
    }
    return pending;
  }

  async remove(bookId: string, origin: DomainActor = "system"): Promise<void> {
    const actor = causalActor(origin);
    this.jobs.get(bookId)?.controller.abort(new AppError("library/book-not-found", "Book was removed"));
    this.jobs.delete(bookId);
    this.failures.delete(bookId);
    this.changed(bookId, actor);
    await this.queueWrite(bookId, () => {
      this.keepNavigation(bookId, null);
      return this.deps.remove(bookId);
    });
    this.changed(bookId, actor);
  }
}
