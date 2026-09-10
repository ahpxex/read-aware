import { AppError } from "@read-aware/core";
import type { ReaderSelectionState } from "./selection-overlay";

/** A command acknowledges React's matching committed overlay, not setState. */
export class SelectionRenderBarrier {
  private committed: ReaderSelectionState | null = null;
  private pending: { state: ReaderSelectionState | null; resolve(): void; reject(error: unknown): void; cleanup(): void } | undefined;
  constructor(private readonly deadlineMs = 10000) {}

  wait(state: ReaderSelectionState | null, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    this.cancel(new AppError("reader/superseded", "Selection render was replaced"));
    if (state === this.committed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const abort = () => this.cancel(signal?.reason ?? new AppError("reader/timeout", "Selection overlay did not commit"));
      const timer = setTimeout(abort, this.deadlineMs);
      this.pending = { state, resolve, reject, cleanup: () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); } };
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
  acknowledge(rendered: ReaderSelectionState | null, desired: ReaderSelectionState | null): void {
    if (rendered !== desired) return;
    this.committed = rendered;
    const pending = this.pending;
    if (!pending) return;
    if (pending.state !== rendered) { this.cancel(new AppError("reader/superseded", "A newer selection committed")); return; }
    this.pending = undefined; pending.cleanup(); pending.resolve();
  }
  retire(): void { this.cancel(new AppError("reader/superseded", "Selection renderer ended")); this.committed = null; }
  private cancel(error: unknown): void {
    const pending = this.pending; this.pending = undefined; pending?.cleanup(); pending?.reject(error);
  }
}
