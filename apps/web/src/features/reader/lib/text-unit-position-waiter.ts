import { AppError } from "@read-aware/core";

/** Wait on navigator transitions, not React's later snapshot publication. */
export class TextUnitPositionWaiter {
  private readonly pending = new Set<() => void>();

  wait<T>(inspect: () => T | undefined, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const cleanup = () => { this.pending.delete(check); signal.removeEventListener("abort", check); };
      const check = () => {
        try {
          if (signal.aborted) throw signal.reason;
          const result = inspect();
          if (result === undefined) return;
          cleanup(); resolve(result);
        } catch (error) { cleanup(); reject(error); }
      };
      this.pending.add(check);
      signal.addEventListener("abort", check, { once: true });
      check();
    });
  }

  notify(): void { for (const check of [...this.pending]) check(); }
}

export const positionUnavailable = () => new AppError("reader/superseded", "Reading mode position owner changed");
