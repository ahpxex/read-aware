import { AppError, errorCode, type HostCommandObservation, type HostCommandSnapshot } from "@read-aware/core";

/** Bounded, serial observations of the authorized command projection, never a command execution queue. */
export class HostCommandObservers {
  private active = 0;
  constructor(private readonly report: (error: unknown) => void) {}

  observe(
    read: (signal: AbortSignal) => Promise<HostCommandSnapshot>,
    subscribe: (invalidate: () => void) => () => void,
    handler: (state: HostCommandObservation) => unknown,
  ): () => void {
    if (this.active >= 64) throw new AppError("ui/observer-limit", "Too many command observers");
    this.active++;
    const controller = new AbortController();
    let dirty = false, running = false, revision = 0, previous: string | undefined;
    const run = async () => {
      if (running || controller.signal.aborted) return;
      running = true;
      try {
        while (dirty && !controller.signal.aborted) {
          dirty = false;
          let value: Omit<Extract<HostCommandObservation, { status: "ready" }>, "revision"> | Omit<Extract<HostCommandObservation, { status: "error" }>, "revision">;
          try { value = { status: "ready", snapshot: await read(controller.signal) }; }
          catch (error) { this.report(error); value = { status: "error", code: errorCode(error) ?? "ui/unavailable" }; }
          if (controller.signal.aborted) return;
          if (dirty) continue;
          const identity = JSON.stringify(value);
          if (identity === previous) continue;
          previous = identity;
          try { await handler({ ...value, revision: ++revision }); }
          catch (error) { this.report(error); }
        }
      } finally { running = false; }
    };
    const invalidate = () => { dirty = true; void run(); };
    let release: () => void;
    try { release = subscribe(invalidate); }
    catch (error) { controller.abort(); this.active--; throw error; }
    invalidate();
    return () => {
      if (controller.signal.aborted) return;
      controller.abort(); this.active--;
      release();
    };
  }
}
