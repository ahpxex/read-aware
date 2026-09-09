import { AppError, type ReaderPanel, type ReaderPanelReceipt, type ReaderPanelsSnapshot, type ReaderPanelsView, type ReadingSessionGuard } from "@read-aware/core";
import type { ReadingSessionController } from "../domain/reading-session-controller";
import { readingRuntime } from "../domain/reading-runtime";
import { createLogger } from "../platform/logger";

type Adapter = {
  apply(panel: ReaderPanel, open: boolean, signal: AbortSignal): Promise<void>;
  requestCommit(token: number): void;
};
type Binding = { sessionId: string; bookId: string; adapter: Adapter; view: ReaderPanelsView; release(): void };
type Pending = {
  binding: Binding; token: number; panel: ReaderPanel; open: boolean; ready: boolean;
  controller: AbortController; resolve(receipt: ReaderPanelReceipt): void; reject(error: unknown): void; cleanup(): void;
};
const panels: readonly ReaderPanel[] = ["toc", "annotations", "appearance", "chat"];

/** S3 presentation service. The reading domain retains session and chrome ownership. */
export class ReaderPanelsService {
  private binding?: Binding;
  private pending?: Pending;
  private revision = 0;
  private token = 0;
  private observers = new Set<(state: ReaderPanelsSnapshot | null) => unknown>();

  constructor(private readonly reading: Pick<ReadingSessionController, "snapshot" | "observe" | "setControls">,
    private readonly report: (error: unknown) => void, private readonly deadlineMs = 10_000) {}

  snapshot(): ReaderPanelsSnapshot | null {
    const binding = this.binding;
    const current = this.reading.snapshot();
    if (!binding || current.status !== "ready" || current.sessionId !== binding.sessionId) return null;
    return { ...structuredClone(binding.view), sessionId: binding.sessionId, bookId: binding.bookId, revision: this.revision };
  }

  observe(handler: (state: ReaderPanelsSnapshot | null) => unknown): () => void {
    this.observers.add(handler); this.deliver(handler);
    return () => this.observers.delete(handler);
  }

  bind(sessionId: string, bookId: string, adapter: Adapter, initial: ReaderPanelsView): { publish(view: ReaderPanelsView, token: number): void; dispose(): void } {
    this.checkGuard({ sessionId, bookId });
    this.binding?.release();
    const binding: Binding = { sessionId, bookId, adapter, view: structuredClone(initial), release: () => {} };
    this.binding = binding;
    const dispose = () => {
      if (this.binding !== binding) return;
      this.binding = undefined;
      this.cancel(new AppError("reader/superseded", "Reader panels session ended"));
      unobserve(); this.changed();
    };
    // Observe can deliver synchronously; the initial guard already proved identity.
    const unobserve = this.reading.observe(state => {
      if (state.sessionId !== sessionId || state.status !== "ready") dispose();
    });
    binding.release = dispose;
    this.changed();
    return { dispose, publish: (view, token) => {
      if (this.binding !== binding) return;
      const hidden = binding.view.controlsVisible && !view.controlsVisible;
      const changed = JSON.stringify(binding.view) !== JSON.stringify(view);
      binding.view = structuredClone(view);
      if (hidden) this.cancel(new AppError("reader/superseded", "Reader controls were hidden"));
      const pending = this.pending;
      let receipt: ReaderPanelReceipt | undefined;
      if (pending?.binding === binding && pending.ready && pending.token === token) {
        const state = view.panels[pending.panel];
        if (state.open === pending.open && (!pending.open || state.visible)) {
          this.pending = undefined; pending.cleanup();
          // Capture this commit before an observer can start another operation.
          receipt = { status: "completed", panel: pending.panel, snapshot: {
            ...structuredClone(view), sessionId, bookId, revision: this.revision + (changed ? 1 : 0),
          } };
        } else this.cancel(new AppError("reader/superseded", "Reader panel state changed before completion"));
      }
      if (changed) this.changed();
      if (receipt) pending!.resolve(receipt);
    } };
  }

  setPanel(panel: ReaderPanel, open: boolean, signal?: AbortSignal, guard?: ReadingSessionGuard): Promise<ReaderPanelReceipt> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (!panels.includes(panel) || typeof open !== "boolean") return Promise.reject(new AppError("reader/invalid-target", "Invalid reader panel operation"));
    try { this.checkGuard(guard); } catch (error) { return Promise.reject(error); }
    const binding = this.binding;
    if (!binding || !this.snapshot()) return Promise.reject(new AppError("reader/unavailable", "Reader panels are not attached"));
    this.cancel(new AppError("reader/superseded", "A newer panel intent replaced this request"));
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const abort = () => {
        if (this.pending?.controller === controller) this.cancel(signal?.reason ?? new AppError("reader/timeout", "Reader panel did not commit"));
      };
      const timer = setTimeout(abort, this.deadlineMs);
      const pending: Pending = { binding, panel, open, controller, token: ++this.token, ready: false, resolve, reject,
        cleanup: () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); } };
      this.pending = pending;
      signal?.addEventListener("abort", abort, { once: true });
      void (async () => {
        if (open) await this.reading.setControls(true, controller.signal, { sessionId: binding.sessionId, bookId: binding.bookId });
        controller.signal.throwIfAborted();
        await binding.adapter.apply(panel, open, controller.signal);
        controller.signal.throwIfAborted();
        if (this.pending !== pending || this.binding !== binding) return;
        pending.ready = true;
        binding.adapter.requestCommit(pending.token);
      })().catch(error => { if (this.pending === pending) this.cancel(error); });
    });
  }

  private checkGuard(guard?: ReadingSessionGuard): void {
    const current = this.reading.snapshot();
    if (guard !== undefined && (!guard || typeof guard !== "object"
      || guard.sessionId !== undefined && typeof guard.sessionId !== "string"
      || guard.bookId !== undefined && typeof guard.bookId !== "string")) throw new AppError("reader/invalid-target", "Invalid session guard");
    if (guard?.sessionId !== undefined && guard.sessionId !== current.sessionId
      || guard?.bookId !== undefined && guard.bookId !== current.bookId) throw new AppError("reader/superseded", "Reader panels target changed");
    if (!current.sessionId || current.status !== "ready") throw new AppError("reader/unavailable", "Reader panels require a ready reader");
  }
  private cancel(error: unknown): void {
    const pending = this.pending; this.pending = undefined;
    if (pending) { pending.cleanup(); pending.controller.abort(error); pending.reject(error); }
  }
  private changed(): void { this.revision++; for (const handler of [...this.observers]) this.deliver(handler); }
  private deliver(handler: (state: ReaderPanelsSnapshot | null) => unknown): void {
    try { Promise.resolve(handler(this.snapshot())).catch(this.report); } catch (error) { this.report(error); }
  }
}

const log = createLogger("reader-panels");
export const readerPanels = new ReaderPanelsService(readingRuntime, error => log.warn("Panel observer failed", error));
