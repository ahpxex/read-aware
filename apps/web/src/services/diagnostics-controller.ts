import { AppError, type HostDiagnosticsPort, type ProjectionVerification } from "@read-aware/core";

type Adapter = { supported(): boolean; verify(): Promise<unknown>; requestReport: HostDiagnosticsPort["requestReport"] };

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new AppError("db/error", "Invalid projection verification count");
  }
  return value;
}

export function projectionVerificationSummary(value: unknown): ProjectionVerification {
  if (!value || typeof value !== "object" || !("consistent" in value) || typeof value.consistent !== "boolean"
    || !("eventsReplayed" in value) || !("drift" in value) || !Array.isArray(value.drift)) {
    throw new AppError("db/error", "Invalid projection verification report");
  }
  let onlyLiveRows = 0, onlyReplayedRows = 0;
  for (const row of value.drift) {
    if (!row || typeof row !== "object" || !("onlyLive" in row) || !("onlyReplayed" in row)) {
      throw new AppError("db/error", "Invalid projection drift report");
    }
    onlyLiveRows = count(onlyLiveRows + count(row.onlyLive));
    onlyReplayedRows = count(onlyReplayedRows + count(row.onlyReplayed));
  }
  if (value.consistent !== (value.drift.length === 0) || value.drift.length > 0 && onlyLiveRows + onlyReplayedRows === 0) {
    throw new AppError("db/error", "Inconsistent projection verification report");
  }
  return { scope: "event-projections", checkedAt: new Date().toISOString(), consistent: value.consistent,
    eventsReplayed: count(value.eventsReplayed), driftedTables: value.drift.length, onlyLiveRows, onlyReplayedRows };
}

/** The native replay owns its lifetime; abandoned callers cannot start a second replay. */
export class HostDiagnosticsService implements HostDiagnosticsPort {
  private active: Promise<ProjectionVerification> | undefined;
  constructor(private adapter: Adapter, private report: (error: unknown) => void) {}

  async requestReport(...args: Parameters<HostDiagnosticsPort["requestReport"]>) {
    args[1]?.throwIfAborted();
    if (!this.adapter.supported()) throw new AppError("ui/unavailable", "Diagnostic reports require desktop");
    try { return await this.adapter.requestReport(...args); }
    catch (error) {
      args[1]?.throwIfAborted();
      this.report(error);
      throw new AppError(error instanceof AppError ? error.code : "ipc/unknown", "Diagnostic report action failed");
    }
  }

  verifyProjections(signal?: AbortSignal): Promise<ProjectionVerification> {
    signal?.throwIfAborted();
    if (!this.adapter.supported()) throw new AppError("ui/unavailable", "Projection verification requires desktop");
    if (!this.active) {
      this.active = Promise.resolve().then(() => this.adapter.verify()).then(projectionVerificationSummary)
        .catch(error => { this.report(error); throw error; }).finally(() => { this.active = undefined; });
    }
    const source = this.active;
    return new Promise((resolve, reject) => {
      const abort = () => { signal?.removeEventListener("abort", abort); reject(signal?.reason); };
      signal?.addEventListener("abort", abort, { once: true });
      source.then(result => {
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) reject(signal.reason);
        else resolve({ ...result });
      }, error => { signal?.removeEventListener("abort", abort); reject(error); });
      if (signal?.aborted) abort();
    });
  }
}
