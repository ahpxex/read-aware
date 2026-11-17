import { AppError } from "@read-aware/core";
import { PendingIntentSlot } from "../../../platform/pending-intent";
import type { ReaderSelectionState } from "./selection-overlay";

/** A command acknowledges React's matching committed overlay, not setState. */
export class SelectionRenderBarrier {
  private committed: ReaderSelectionState | null = null;
  private readonly pending: PendingIntentSlot<ReaderSelectionState | null, void>;
  constructor(deadlineMs = 10000) {
    this.pending = new PendingIntentSlot({
      deadlineMs,
      timeout: () => new AppError("reader/timeout", "Selection overlay did not commit"),
      superseded: () => new AppError("reader/superseded", "Selection render was replaced"),
    });
  }

  wait(state: ReaderSelectionState | null, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    this.pending.cancel(new AppError("reader/superseded", "Selection render was replaced"));
    if (state === this.committed) return Promise.resolve();
    return this.pending.begin(state, signal).settled;
  }
  acknowledge(rendered: ReaderSelectionState | null, desired: ReaderSelectionState | null): void {
    if (rendered !== desired) return;
    this.committed = rendered;
    const intent = this.pending.current;
    if (!intent) return;
    if (intent.payload !== rendered)
      this.pending.cancel(new AppError("reader/superseded", "A newer selection committed"));
    else this.pending.confirm(intent, undefined);
  }
  retire(): void {
    this.pending.cancel(new AppError("reader/superseded", "Selection renderer ended"));
    this.committed = null;
  }
}
