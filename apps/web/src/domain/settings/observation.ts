import { AppError, errorCode, type SettingsObservation, type SettingsObservationCause, type SettingsSnapshot } from "@read-aware/core";

const mergeCause = (a: SettingsObservationCause | undefined, b: SettingsObservationCause): SettingsObservationCause =>
  !a ? b : { source: a.source === b.source ? a.source : "mixed", origin: a.origin === b.origin ? a.origin : null };

/** Invalidation clock, not a second settings store. Each consumer reads the settled authorized projection. */
export class SettingsObservationHub {
  revision = 0;
  private listeners = new Set<(cause: SettingsObservationCause) => void>();
  constructor(private readonly report: (error: unknown) => void) {}

  invalidate(cause: SettingsObservationCause): void {
    this.revision++;
    for (const listener of [...this.listeners]) listener(cause);
  }

  observe(read: () => Promise<SettingsSnapshot>, handler: (observation: SettingsObservation) => unknown): () => void {
    if (this.listeners.size >= 64) throw new AppError("settings/observer-limit", "Too many settings observers");
    let disposed = false, running = false, dirty = false, first = true;
    let pending: SettingsObservationCause | undefined, previous: string | undefined;
    const run = async () => {
      if (running || disposed) return;
      running = true;
      try {
        while (dirty && !disposed) {
          dirty = false;
          const cause = pending!; pending = undefined;
          let observation: SettingsObservation;
          try { observation = { ...cause, status: "ready", snapshot: await read() }; }
          catch (error) {
            this.report(error);
            observation = { ...cause, status: "error", revision: this.revision, code: errorCode(error) ?? "settings/unavailable" };
          }
          if (disposed) return;
          // Never attach an old cause to a snapshot taken after a newer commit.
          if (dirty) { pending = mergeCause(cause, pending!); continue; }
          const identity = observation.status === "ready"
            ? JSON.stringify({ ...observation.snapshot, revision: 0 }) : `error:${observation.code}`;
          if (identity === previous) continue;
          previous = identity;
          if (first) { observation.source = "initial"; observation.origin = null; first = false; }
          try { await handler(observation); } catch (error) { this.report(error); }
        }
      } finally { running = false; }
    };
    const notify = (cause: SettingsObservationCause) => {
      if (disposed) return;
      pending = mergeCause(pending, cause); dirty = true; void run();
    };
    this.listeners.add(notify); notify({ source: "initial", origin: null });
    return () => { disposed = true; this.listeners.delete(notify); };
  }
}
