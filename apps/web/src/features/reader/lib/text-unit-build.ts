import { AppError } from "@read-aware/core";

export type TextUnitBuildResult<T> = (
  | { status: "ready"; value: T }
  | { status: "failed"; error: unknown }
) & { isCurrent(): boolean };

/** A build owns its cancellation signal and all continuations, not just its result. */
export class TextUnitBuild {
  private current: AbortController | undefined;

  constructor(private readonly deadlineMs = 30_000) {}

  invalidate(): void {
    const previous = this.current;
    this.current = undefined;
    previous?.abort(new AppError("reader/superseded", "Reading units were replaced"));
  }

  async run<T>(build: (signal: AbortSignal) => Promise<T>): Promise<TextUnitBuildResult<T> | null> {
    this.invalidate();
    const owner = new AbortController();
    this.current = owner;
    const isCurrent = () => this.current === owner;
    let onAbort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(owner.signal.reason);
      owner.signal.addEventListener("abort", onAbort, { once: true });
    });
    const timer = setTimeout(() => owner.abort(new AppError("reader/timeout", "Reading unit segmentation timed out")), this.deadlineMs);
    try {
      const value = await Promise.race([Promise.resolve().then(() => {
        if (owner.signal.aborted) throw owner.signal.reason;
        return build(owner.signal);
      }), cancelled]);
      return isCurrent() ? { status: "ready", value, isCurrent } : null;
    } catch (error) {
      return isCurrent() ? { status: "failed", error, isCurrent } : null;
    } finally {
      clearTimeout(timer);
      owner.signal.removeEventListener("abort", onAbort);
    }
  }
}
