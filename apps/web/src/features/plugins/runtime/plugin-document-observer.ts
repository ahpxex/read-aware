import { AppError, errorCode } from "@read-aware/core";
import type { PluginDocumentObservation, PluginDocumentObservationResult, PluginDisposable } from "@read-aware/plugin-types";
import { createLogger } from "../../../platform/logger";
import type { PluginLifecycleController } from "./plugin-lifecycle";

const log = createLogger("plugin-documents");
const defaults = {
  schedule(work: () => void) { const timer = setTimeout(work, 1000); return () => clearTimeout(timer); },
  report(error: unknown) { log.warn("Private document observation failed", error); },
};

/** Private query snapshots, not write events. Each owner shares one limit. */
export class PluginDocumentObserver {
  private count = 0;
  constructor(private readonly lifecycle: PluginLifecycleController, private readonly deps = defaults) {}

  observe<T>(read: () => Promise<PluginDocumentObservationResult<T>>, handler: (event: PluginDocumentObservation<T>) => unknown): PluginDisposable {
    if (typeof handler !== "function") throw new AppError("plugin/invalid-argument", "Expected document observation callback");
    return this.lifecycle.stage(() => {
      if (this.lifecycle.signal.aborted) throw new AppError("plugin/cancelled", "Document observer owner retired");
      if (this.count >= 64) throw new AppError("plugin/quota-exceeded", "Too many document observers");
      ++this.count;
      let disposed = false, sequence = 0, delivered: string | undefined, cancelTimer: (() => void) | undefined;
      const dispose = () => {
        if (disposed) return;
        disposed = true; --this.count; cancelTimer?.(); cancelTimer = undefined;
        this.lifecycle.signal.removeEventListener("abort", dispose);
      };
      const poll = async () => {
        let sample: { status: "ready"; result: PluginDocumentObservationResult<T> } | { status: "error"; errorCode: string };
        try { sample = { status: "ready", result: await read() }; }
        catch (error) {
          if (disposed) return;
          this.deps.report(error);
          sample = { status: "error", errorCode: errorCode(error) ?? "ipc/unknown" };
        }
        if (disposed) return;
        const identity = JSON.stringify(sample);
        if (identity !== delivered) {
          try { await handler({ ...structuredClone(sample), sequence: ++sequence }); delivered = identity; }
          catch (error) { this.deps.report(error); }
        }
        if (!disposed) cancelTimer = this.deps.schedule(() => { cancelTimer = undefined; void poll(); });
      };
      this.lifecycle.signal.addEventListener("abort", dispose, { once: true });
      void poll();
      return { dispose };
    });
  }
}
