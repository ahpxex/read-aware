import { causalActor, type DomainActor } from "../platform/domain-actor";
import {
  AppError,
  normalizeBookImageQuery,
  type BookImageQuery,
  type ReaderImageOpenReceipt,
  type ReaderImageSnapshot,
  type ReadingSessionGuard,
} from "@read-aware/core";
import type { ReadingSessionController } from "../domain/reading-session-controller";
import { readingRuntime } from "../domain/reading-runtime";
import { watchReaderSession } from "../domain/reader-session-watch";
import type { BookImageData } from "../features/library/lib/book-images";
import { readerImage, type ReaderImageService } from "./reader-image";

type Adapter = {
  present(id: string, image: Extract<BookImageData, { status: "ready" }>, origin: DomainActor): void;
  clear(id: string, origin: DomainActor): void;
};
type Pending = { controller: AbortController; origin: DomainActor; cancelledBy?: DomainActor };
type Binding = { sessionId: string; bookId: string; adapter: Adapter; dispose(origin?: DomainActor): void };
const superseded = () => new AppError("reader/superseded", "Image opening was replaced or the reader changed");

/** Resolves only book descriptors; arbitrary URLs and resource handles are not viewer inputs. */
export class ReaderImageOpenService {
  private binding?: Binding;
  private pending?: Pending;
  private cancel(origin?: DomainActor, reason: unknown = superseded()): void {
    const pending = this.pending;
    if (!pending || pending.controller.signal.aborted) return;
    pending.cancelledBy = causalActor(origin ?? pending.origin);
    pending.controller.abort(reason);
  }
  constructor(
    private reading: Pick<ReadingSessionController, "snapshot" | "observe">,
    private images: Pick<ReaderImageService, "snapshot" | "observe">,
    private deadlineMs = 10_000,
  ) {}

  bind(sessionId: string, bookId: string, adapter: Adapter) {
    this.binding?.dispose();
    const binding: Binding = { sessionId, bookId, adapter, dispose: () => {} };
    this.binding = binding;
    let stop: () => void = () => {};
    const interrupt = (origin: DomainActor = "user") => {
      if (this.binding === binding) this.cancel(origin);
    };
    const dispose = (origin?: DomainActor) => {
      if (this.binding !== binding) return;
      this.cancel(origin);
      this.binding = undefined;
      stop();
    };
    binding.dispose = dispose;
    stop = watchReaderSession(this.reading, { sessionId, bookId }, dispose);
    return { dispose, interrupt };
  }

  async open(
    input: BookImageQuery,
    read: (query: BookImageQuery, signal: AbortSignal, origin: DomainActor) => Promise<BookImageData>,
    signal?: AbortSignal,
    guard?: ReadingSessionGuard,
    origin: DomainActor = "user",
  ): Promise<ReaderImageOpenReceipt> {
    const query = normalizeBookImageQuery(input);
    signal?.throwIfAborted();
    const binding = this.requireBinding(query, guard);
    origin = causalActor(origin);
    this.cancel(origin);
    const pending: Pending = { controller: new AbortController(), origin };
    this.pending = pending;
    const abort = () => {
      if (this.pending === pending) this.cancel(origin, signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      if (this.pending === pending) this.cancel(origin, new AppError("reader/timeout", "Image viewer did not commit"));
    }, this.deadlineMs);
    let id: string | undefined;
    try {
      // Keep the parser lease until it actually settles, including after cancellation.
      const data = await read(query, pending.controller.signal, origin);
      pending.controller.signal.throwIfAborted();
      if (this.binding !== binding) throw superseded();
      this.requireBinding(query, { sessionId: binding.sessionId });
      if (data.status !== "ready") return { status: "not-opened", reason: data.status };
      id = crypto.randomUUID();
      binding.adapter.present(id, data, origin);
      const snapshot = await this.waitForImage(id, pending.controller.signal);
      pending.controller.signal.throwIfAborted();
      this.requireBinding(query, { sessionId: binding.sessionId });
      return { status: "opened", snapshot };
    } catch (error) {
      if (id) binding.adapter.clear(id, pending.cancelledBy ?? origin);
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (this.pending === pending) this.pending = undefined;
    }
  }

  private waitForImage(id: string, signal: AbortSignal): Promise<ReaderImageSnapshot> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      let stop = () => {},
        done = false;
      const cleanup = () => {
        done = true;
        stop();
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      stop = this.images.observe((value) => {
        if (!done && value?.id === id) {
          cleanup();
          resolve(value);
        }
      });
      if (done) stop();
    });
  }

  private requireBinding(query: BookImageQuery, guard?: ReadingSessionGuard): Binding {
    const state = this.reading.snapshot(),
      binding = this.binding;
    if (
      guard !== undefined &&
      (!guard ||
        typeof guard !== "object" ||
        Array.isArray(guard) ||
        Object.keys(guard).some((key) => !["sessionId", "bookId"].includes(key)) ||
        (guard.sessionId !== undefined && typeof guard.sessionId !== "string") ||
        (guard.bookId !== undefined && typeof guard.bookId !== "string"))
    )
      throw new AppError("reader/invalid-target", "Invalid image session guard");
    if (
      (guard?.sessionId !== undefined && guard.sessionId !== state.sessionId) ||
      (guard?.bookId !== undefined && guard.bookId !== state.bookId)
    )
      throw superseded();
    if (!binding || state.status !== "ready" || binding.sessionId !== state.sessionId)
      throw new AppError("reader/unavailable", "Image opening needs a mounted reader");
    if (query.image.bookId !== state.bookId || query.image.bookId !== binding.bookId)
      throw new AppError("reader/out-of-scope", "Open the image's book first");
    if (state.location?.contentVersion !== query.image.contentVersion)
      throw new AppError("reader/stale-location", "Image belongs to another content revision");
    return binding;
  }
}
export const readerImageOpen = new ReaderImageOpenService(readingRuntime, readerImage);
