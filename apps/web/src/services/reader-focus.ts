import { AppError, assertReaderFocusTarget, type ReaderFocusOutcome, type ReaderFocusReceipt, type ReaderFocusTarget, type ReadingSessionGuard } from "@read-aware/core";
import type { ReadingSessionController } from "../domain/reading-session-controller";
import { readingRuntime } from "../domain/reading-runtime";

type Binding = { sessionId: string; bookId: string; focus(): ReaderFocusOutcome };

/** Host-only semantic targets. No element, selector or callback crosses the public API. */
export class ReaderFocusService {
  private readonly targets = new Map<ReaderFocusTarget, Binding>();
  constructor(private readonly reading: Pick<ReadingSessionController, "snapshot">) {}

  bind(target: ReaderFocusTarget, binding: Binding): () => void {
    this.targets.set(target, binding);
    return () => { if (this.targets.get(target) === binding) this.targets.delete(target); };
  }

  async focus(target: ReaderFocusTarget, signal?: AbortSignal, guard?: ReadingSessionGuard): Promise<ReaderFocusReceipt> {
    assertReaderFocusTarget(target);
    signal?.throwIfAborted();
    if (guard !== undefined && (!guard || typeof guard !== "object" || Array.isArray(guard)
      || Object.keys(guard).some(key => key !== "sessionId" && key !== "bookId")
      || guard.sessionId !== undefined && typeof guard.sessionId !== "string"
      || guard.bookId !== undefined && typeof guard.bookId !== "string")) throw new AppError("reader/invalid-target", "Invalid focus session guard");
    const current = this.reading.snapshot();
    if (guard?.bookId !== undefined && guard.bookId !== current.bookId
      || guard?.sessionId !== undefined && guard.sessionId !== current.sessionId) throw new AppError("reader/superseded", "Focus target session changed");
    if (current.status !== "ready" || !current.sessionId || !current.bookId) throw new AppError("reader/unavailable", "No ready reader to focus");
    const identity = { target, sessionId: current.sessionId, bookId: current.bookId };
    const binding = this.targets.get(target);
    if (!binding || binding.sessionId !== current.sessionId || binding.bookId !== current.bookId) return { ...identity, status: "not-focused", reason: "missing" };
    const outcome = binding.focus();
    const after = this.reading.snapshot();
    // Focus handlers may synchronously replace the reader or the target.
    if (after.status !== "ready" || after.sessionId !== current.sessionId || this.targets.get(target) !== binding) {
      throw new AppError("reader/superseded", "Reader changed during focus");
    }
    return { ...identity, ...outcome };
  }
}

export const readerFocus = new ReaderFocusService(readingRuntime);
