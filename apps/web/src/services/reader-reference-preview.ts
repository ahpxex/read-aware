import { AppError, normalizeBookReferenceQuery, type BookReferenceQuery, type BookReferencePreview,
  type ReaderReferencePreviewReceipt, type ReaderReferenceCloseReceipt, type ReadingSessionGuard } from "@read-aware/core";
import type { ReadingSessionController } from "../domain/reading-session-controller";
import { readingRuntime } from "../domain/reading-runtime";

export type ReferencePreviewView = { id: string; preview: BookReferencePreview };
type Adapter = { begin?(): void; present(view: ReferencePreviewView, signal: AbortSignal): Promise<void>; clear(id: string): Promise<void> };
type Binding = { sessionId: string; bookId: string; adapter: Adapter; dispose(): void };
type Owner = object | string;
type Active = { owner: Owner; id: string; binding: Binding };
type Pending = { owner: Owner; binding: Binding; controller: AbortController; displayedId?: string };
const superseded = () => new AppError("reader/superseded", "Reference preview was replaced or the reading session ended");

/** One native preview surface, with actor ownership and renderer acknowledgement. */
export class ReaderReferencePreviewService {
  private binding?: Binding;
  private active?: Active;
  private pending?: Pending;
  constructor(private readonly reading: Pick<ReadingSessionController, "snapshot" | "observe">) {}

  bind(sessionId: string, bookId: string, adapter: Adapter): { dispose(): void; interrupt(): void } {
    this.binding?.dispose();
    const binding: Binding = { sessionId, bookId, adapter, dispose: () => {} };
    this.binding = binding;
    let unobserve = () => {};
    const dispose = () => {
      if (this.binding !== binding) return;
      this.binding = undefined;
      this.interrupt(); unobserve();
    };
    binding.dispose = dispose;
    unobserve = this.reading.observe(state => {
      if (state.status !== "ready" || state.sessionId !== sessionId || state.bookId !== bookId) dispose();
    });
    if (this.binding !== binding) unobserve();
    return { dispose, interrupt: () => { if (this.binding === binding) this.interrupt(); } };
  }

  /** A native click/dismissal owns the surface over all earlier API requests. */
  private interrupt(): void {
    this.pending?.controller.abort(superseded());
    this.pending = undefined;
    this.active = undefined;
  }

  async open(owner: Owner, input: BookReferenceQuery, read: (query: BookReferenceQuery, signal: AbortSignal) => Promise<BookReferencePreview>,
    signal?: AbortSignal, guard?: ReadingSessionGuard): Promise<ReaderReferencePreviewReceipt> {
    const query = normalizeBookReferenceQuery(input);
    signal?.throwIfAborted();
    const binding = this.requireBinding(query.reference.bookId, guard);
    if (this.reading.snapshot().location?.contentVersion !== query.reference.contentVersion) throw new AppError("reader/stale-location", "Reference is not from the displayed book revision");
    binding.adapter.begin?.();
    this.pending?.controller.abort(superseded());
    const pending: Pending = { owner, binding, controller: new AbortController() };
    this.pending = pending;
    const abort = () => pending.controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    let displayed: Active | undefined;
    try {
      // Await the actual parse even after cancellation so plugin lifecycle drain retains its lease.
      const preview = await read(query, pending.controller.signal);
      pending.controller.signal.throwIfAborted();
      if (this.pending !== pending || this.binding !== binding) throw superseded();
      this.requireBinding(query.reference.bookId, { sessionId: binding.sessionId });
      if (this.reading.snapshot().location?.contentVersion !== query.reference.contentVersion) throw new AppError("reader/stale-location", "Displayed content revision changed");
      if (preview.status !== "resolved") return { status: "not-opened", preview };
      displayed = { owner, id: crypto.randomUUID(), binding };
      pending.displayedId = displayed.id;
      this.active = displayed;
      await binding.adapter.present({ id: displayed.id, preview }, pending.controller.signal);
      pending.controller.signal.throwIfAborted();
      if (this.active !== displayed || this.binding !== binding) throw superseded();
      return { status: "opened", id: displayed.id, sessionId: binding.sessionId, preview };
    } catch (error) {
      if (displayed && this.active === displayed) {
        this.active = undefined;
        await binding.adapter.clear(displayed.id);
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (this.pending === pending) this.pending = undefined;
    }
  }

  async close(owner: Owner, id: string, signal?: AbortSignal): Promise<ReaderReferenceCloseReceipt> {
    signal?.throwIfAborted();
    if (typeof id !== "string" || !id || id.length > 256) throw new AppError("reader/invalid-target", "Invalid preview identity");
    const active = this.active;
    if (!active || active.owner !== owner || active.id !== id) return { status: "not-current", id };
    this.active = undefined;
    if (this.pending?.displayedId === id) { this.pending.controller.abort(superseded()); this.pending = undefined; }
    await active.binding.adapter.clear(id);
    signal?.throwIfAborted();
    return { status: "closed", id };
  }

  async release(owner: Owner): Promise<void> {
    if (this.pending?.owner === owner) { this.pending.controller.abort(superseded()); this.pending = undefined; }
    const active = this.active;
    if (!active || active.owner !== owner) return;
    this.active = undefined;
    await active.binding.adapter.clear(active.id);
  }

  private requireBinding(bookId: string, guard?: ReadingSessionGuard): Binding {
    const state = this.reading.snapshot(), binding = this.binding;
    if (guard !== undefined && (!guard || typeof guard !== "object" || Array.isArray(guard)
      || Object.keys(guard).some(key => !["sessionId", "bookId"].includes(key))
      || guard.sessionId !== undefined && typeof guard.sessionId !== "string"
      || guard.bookId !== undefined && typeof guard.bookId !== "string")) throw new AppError("reader/invalid-target", "Invalid preview session guard");
    if (guard?.sessionId !== undefined && guard.sessionId !== state.sessionId
      || guard?.bookId !== undefined && guard.bookId !== state.bookId) throw superseded();
    if (!binding || state.status !== "ready" || binding.sessionId !== state.sessionId) throw new AppError("reader/unavailable", "Reference preview needs a mounted reader");
    if (bookId !== state.bookId || bookId !== binding.bookId) throw new AppError("reader/out-of-scope", "Open the reference's book first");
    return binding;
  }
}

export const readerReferencePreview = new ReaderReferencePreviewService(readingRuntime);
