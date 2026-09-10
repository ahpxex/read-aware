import { AppError, normalizeBookImageQuery, type BookImageQuery, type ReaderImageOpenReceipt,
  type ReaderImageSnapshot, type ReadingSessionGuard } from "@read-aware/core";
import type { ReadingSessionController } from "../domain/reading-session-controller";
import { readingRuntime } from "../domain/reading-runtime";
import type { BookImageData } from "../features/library/lib/book-images";
import { readerImage, type ReaderImageService } from "./reader-image";

type Adapter = { present(id: string, image: Extract<BookImageData, { status: "ready" }>): void; clear(id: string): void };
type Binding = { sessionId: string; bookId: string; adapter: Adapter; dispose(): void };
const superseded = () => new AppError("reader/superseded", "Image opening was replaced or the reader changed");

/** Resolves only book descriptors; arbitrary URLs and resource handles are not viewer inputs. */
export class ReaderImageOpenService {
  private binding?: Binding;
  private pending?: AbortController;
  constructor(private reading: Pick<ReadingSessionController, "snapshot" | "observe">,
    private images: Pick<ReaderImageService, "snapshot" | "observe">, private deadlineMs = 10_000) {}

  bind(sessionId: string, bookId: string, adapter: Adapter) {
    this.binding?.dispose();
    const binding: Binding = { sessionId, bookId, adapter, dispose: () => {} };
    this.binding = binding;
    let stop = () => {};
    const interrupt = () => { if (this.binding === binding) this.pending?.abort(superseded()); };
    const dispose = () => {
      if (this.binding !== binding) return;
      interrupt(); this.binding = undefined; stop();
    };
    binding.dispose = dispose;
    stop = this.reading.observe(state => {
      if (state.status !== "ready" || state.sessionId !== sessionId || state.bookId !== bookId) dispose();
    });
    if (this.binding !== binding) stop();
    return { dispose, interrupt };
  }

  async open(input: BookImageQuery, read: (query: BookImageQuery, signal: AbortSignal) => Promise<BookImageData>,
    signal?: AbortSignal, guard?: ReadingSessionGuard): Promise<ReaderImageOpenReceipt> {
    const query = normalizeBookImageQuery(input);
    signal?.throwIfAborted();
    const binding = this.requireBinding(query, guard);
    this.pending?.abort(superseded());
    const pending = new AbortController(); this.pending = pending;
    const abort = () => pending.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => pending.abort(new AppError("reader/timeout", "Image viewer did not commit")), this.deadlineMs);
    let id: string | undefined;
    try {
      // Keep the parser lease until it actually settles, including after cancellation.
      const data = await read(query, pending.signal);
      pending.signal.throwIfAborted();
      if (this.binding !== binding) throw superseded();
      this.requireBinding(query, { sessionId: binding.sessionId });
      if (data.status !== "ready") return { status: "not-opened", reason: data.status };
      id = crypto.randomUUID();
      binding.adapter.present(id, data);
      const snapshot = await this.waitForImage(id, pending.signal);
      pending.signal.throwIfAborted();
      this.requireBinding(query, { sessionId: binding.sessionId });
      return { status: "opened", snapshot };
    } catch (error) {
      if (id) binding.adapter.clear(id);
      throw error;
    } finally {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (this.pending === pending) this.pending = undefined;
    }
  }

  private waitForImage(id: string, signal: AbortSignal): Promise<ReaderImageSnapshot> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      let stop = () => {}, done = false;
      const cleanup = () => { done = true; stop(); signal.removeEventListener("abort", abort); };
      const abort = () => { cleanup(); reject(signal.reason); };
      signal.addEventListener("abort", abort, { once: true });
      stop = this.images.observe(value => { if (!done && value?.id === id) { cleanup(); resolve(value); } });
      if (done) stop();
    });
  }

  private requireBinding(query: BookImageQuery, guard?: ReadingSessionGuard): Binding {
    const state = this.reading.snapshot(), binding = this.binding;
    if (guard !== undefined && (!guard || typeof guard !== "object" || Array.isArray(guard)
      || Object.keys(guard).some(key => !["sessionId", "bookId"].includes(key))
      || guard.sessionId !== undefined && typeof guard.sessionId !== "string"
      || guard.bookId !== undefined && typeof guard.bookId !== "string")) throw new AppError("reader/invalid-target", "Invalid image session guard");
    if (guard?.sessionId !== undefined && guard.sessionId !== state.sessionId
      || guard?.bookId !== undefined && guard.bookId !== state.bookId) throw superseded();
    if (!binding || state.status !== "ready" || binding.sessionId !== state.sessionId) throw new AppError("reader/unavailable", "Image opening needs a mounted reader");
    if (query.image.bookId !== state.bookId || query.image.bookId !== binding.bookId) throw new AppError("reader/out-of-scope", "Open the image's book first");
    if (state.location?.contentVersion !== query.image.contentVersion) throw new AppError("reader/stale-location", "Image belongs to another content revision");
    return binding;
  }
}
export const readerImageOpen = new ReaderImageOpenService(readingRuntime, readerImage);
