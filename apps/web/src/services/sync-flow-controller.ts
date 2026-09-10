import { AppError, type HostSyncFlow, type HostSyncFlowReceipt, type HostSyncFlowRequest } from "@read-aware/core";

type Surface = { open(request: HostSyncFlowRequest): void; close(): void };
type Pending = {
  request: HostSyncFlowRequest; surface: Surface; started: boolean; epoch: number;
  signal?: AbortSignal;
  resolve(receipt: HostSyncFlowReceipt): void; reject(error: unknown): void;
  cleanup(): void;
};

/** Only the settings owner can perform/settle an action. Callers receive no
 * confirmation handles and cannot approve their own destructive requests. */
export class SyncFlowController {
  private surface?: Surface;
  private pending?: Pending;
  private requesting = false;
  private running = false;
  constructor(private navigate: (signal?: AbortSignal) => Promise<unknown>, private epoch: () => number = () => 0) {}

  bind(surface: Surface): () => void {
    this.surface = surface;
    return () => {
      if (this.surface !== surface) return;
      this.surface = undefined;
      const pending = this.pending;
      // A confirmed native operation keeps ownership until its real settlement.
      if (pending?.surface === surface && !pending.started) this.settle(pending, "cancelled");
    };
  }

  async request(input: HostSyncFlowRequest, signal?: AbortSignal): Promise<HostSyncFlowReceipt> {
    signal?.throwIfAborted();
    if (!input || !["connect", "disconnect", "delete-account", "upgrade", "billing"].includes(input.action)
      || (input.transportRef !== undefined && (input.action !== "connect" || typeof input.transportRef !== "string" || !input.transportRef.length || input.transportRef.length > 256))) {
      throw new AppError("ui/invalid-target", "Invalid sync flow");
    }
    if (this.requesting || this.pending || this.running) throw new AppError("ui/unavailable", "A sync account flow is already active");
    this.requesting = true;
    try {
      const request = { action: input.action, ...(input.transportRef !== undefined ? { transportRef: input.transportRef } : {}) };
      await this.navigate(signal);
      signal?.throwIfAborted();
      if (this.running) throw new AppError("ui/unavailable", "A native sync account action started during navigation");
      const surface = this.surface;
      if (!surface) throw new AppError("ui/unavailable", "Sync account controls are not mounted");
      return await new Promise<HostSyncFlowReceipt>((resolve, reject) => {
        const abort = () => {
          if (this.pending !== pending || pending.started) return;
          this.settle(pending, "cancelled");
          surface.close();
        };
        const pending: Pending = { request, surface, signal, started: false, epoch: this.epoch(), resolve, reject,
          cleanup: () => signal?.removeEventListener("abort", abort) };
        this.pending = pending;
        signal?.addEventListener("abort", abort, { once: true });
        try { surface.open(request); }
        catch (error) { this.fail(pending, error); }
      });
    } finally { this.requesting = false; }
  }

  dismiss(action: HostSyncFlow): void {
    const pending = this.pending;
    if (pending?.request.action === action && !pending.started) this.settle(pending, "cancelled");
  }

  /** Used by the existing native UI command callbacks, not exported to actors. */
  async run<T>(action: HostSyncFlow, operation: (signal?: AbortSignal) => Promise<T>, retryInDialog = false): Promise<T> {
    if (this.running) throw new AppError("ui/unavailable", "Sync account action is already running");
    const pending = this.pending;
    if (pending && pending.request.action !== action) throw new AppError("ui/unavailable", "Another sync account dialog owns this request");
    pending?.signal?.throwIfAborted();
    if (pending && pending.epoch !== this.epoch()) {
      const error = new AppError("ui/superseded", "Sync connection changed before confirmation");
      this.fail(pending, error);
      throw error;
    }
    if (pending) pending.started = true;
    this.running = true;
    try {
      const result = await operation(pending?.signal);
      if (pending) this.settle(pending, action === "upgrade" || action === "billing" ? "external-opened" : "completed");
      return result;
    } catch (error) {
      if (pending) {
        pending.started = false;
        if (pending.signal?.aborted) this.settle(pending, "cancelled");
        else if (!retryInDialog || this.surface !== pending.surface) this.fail(pending, error);
      }
      throw error;
    } finally {
      this.running = false;
      if (pending?.signal?.aborted) pending.surface.close();
    }
  }

  private settle(pending: Pending, status: HostSyncFlowReceipt["status"]): void {
    if (this.pending !== pending) return;
    this.pending = undefined; pending.cleanup();
    if (pending.signal?.aborted) pending.reject(pending.signal.reason);
    else pending.resolve({ action: pending.request.action, status });
  }
  private fail(pending: Pending, error: unknown): void {
    if (this.pending !== pending) return;
    this.pending = undefined; pending.cleanup(); pending.reject(error);
  }
}
