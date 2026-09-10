import { AppError, normalizeReaderImageRequest, type ReaderImageAction, type ReaderImageReceipt,
  type ReaderImageRequest, type ReaderImageSnapshot, type ReaderImageTransform } from "@read-aware/core";
import type { ReadingSessionController } from "../domain/reading-session-controller";
import { readingRuntime } from "../domain/reading-runtime";
import { createLogger } from "../platform/logger";

type Identity = { id: string; bookId: string; sessionId: string };
type Adapter = { apply(action: ReaderImageAction, token: number): void; close(): void };
type Binding = { identity: Identity; view: ReaderImageTransform; adapter: Adapter; dispose(): void };
type Pending = { binding: Binding; token: number; close: boolean; resolve(value: ReaderImageReceipt): void; reject(error: unknown): void; cleanup(): void };
const superseded = () => new AppError("reader/superseded", "The image viewer or its intent changed");

/** Controls only the user's already-open native lightbox; never resolves image URLs. */
export class ReaderImageService {
  private binding?: Binding;
  private pending?: Pending;
  private revision = 0;
  private token = 0;
  private listeners = new Set<() => void>();
  constructor(private reading: Pick<ReadingSessionController, "snapshot" | "observe">,
    private report: (error: unknown) => void, private deadlineMs = 10_000) {}

  snapshot(): ReaderImageSnapshot | null {
    const b = this.binding, session = this.reading.snapshot();
    if (!b || session.status !== "ready" || session.sessionId !== b.identity.sessionId || session.bookId !== b.identity.bookId) return null;
    return { ...b.identity, ...b.view, revision: this.revision };
  }
  observe(handler: (value: ReaderImageSnapshot | null) => unknown): () => void {
    if (typeof handler !== "function") throw new AppError("reader/invalid-target", "Expected image observer");
    if (this.listeners.size >= 64) throw new AppError("ui/observer-limit", "Too many image observers");
    let stopped = false, running = false, dirty = false;
    const deliver = async () => {
      dirty = true; if (stopped || running) return;
      running = true;
      try {
        do {
          dirty = false;
          try { await handler(this.snapshot()); } catch (error) { this.report(error); }
        } while (dirty && !stopped);
      } finally { running = false; }
    };
    const notify = () => { void deliver(); };
    this.listeners.add(notify); notify();
    return () => { stopped = true; this.listeners.delete(notify); };
  }
  private changed() { this.revision++; for (const listener of this.listeners) listener(); }
  private cancel(error: unknown) {
    const pending = this.pending; this.pending = undefined;
    if (pending) { pending.cleanup(); pending.reject(error); }
  }
  bind(identity: Identity, adapter: Adapter, initial: ReaderImageTransform) {
    const session = this.reading.snapshot();
    if (session.status !== "ready" || session.sessionId !== identity.sessionId || session.bookId !== identity.bookId) throw superseded();
    this.binding?.dispose();
    const binding: Binding = { identity: { ...identity }, view: { ...initial }, adapter, dispose: () => {} };
    this.binding = binding;
    let unobserve = () => {};
    const dispose = () => {
      if (this.binding !== binding) return;
      this.binding = undefined; unobserve();
      const pending = this.pending;
      if (pending?.binding === binding && pending.close) {
        this.pending = undefined; pending.cleanup(); pending.resolve({ status: "closed", id: identity.id });
      } else this.cancel(superseded());
      this.changed();
    };
    binding.dispose = dispose;
    unobserve = this.reading.observe(state => {
      if (state.status !== "ready" || state.sessionId !== identity.sessionId || state.bookId !== identity.bookId) {
        this.cancel(superseded()); dispose(); adapter.close();
      }
    });
    if (this.binding !== binding) unobserve();
    this.changed();
    return { dispose, publish: (view: ReaderImageTransform, token: number) => {
      if (this.binding !== binding) return;
      const changed = JSON.stringify(view) !== JSON.stringify(binding.view);
      binding.view = { ...view };
      const pending = this.pending;
      let receipt: ReaderImageReceipt | undefined;
      if (pending?.binding === binding && !pending.close && pending.token === token) {
        this.pending = undefined; pending.cleanup();
        receipt = { status: "updated", snapshot: { ...identity, ...view, revision: this.revision + (changed ? 1 : 0) } };
      }
      if (changed) this.changed();
      if (receipt) pending!.resolve(receipt);
    } };
  }
  control(input: ReaderImageRequest, signal?: AbortSignal): Promise<ReaderImageReceipt> {
    const request = normalizeReaderImageRequest(input);
    signal?.throwIfAborted();
    const binding = this.binding, state = this.snapshot();
    if (!binding || !state) return Promise.reject(new AppError("reader/unavailable", "No active image viewer"));
    if (state.id !== request.id) return Promise.reject(superseded());
    this.cancel(superseded());
    return new Promise((resolve, reject) => {
      const abort = () => { if (this.pending === pending) this.cancel(signal?.reason ?? new AppError("reader/timeout", "Image viewer did not commit")); };
      const timer = setTimeout(abort, this.deadlineMs);
      const pending: Pending = { binding, token: ++this.token, close: request.action === "close", resolve, reject,
        cleanup: () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); } };
      this.pending = pending; signal?.addEventListener("abort", abort, { once: true });
      try {
        if (request.action === "close") binding.adapter.close();
        else binding.adapter.apply(request, pending.token);
      } catch (error) { if (this.pending === pending) this.cancel(error); }
    });
  }
}
const log = createLogger("reader-image");
export const readerImage = new ReaderImageService(readingRuntime, error => log.warn("Image observer failed", error));
