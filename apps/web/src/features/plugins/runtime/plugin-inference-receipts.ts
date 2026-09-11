import { AppError, errorCode, type InferenceAttemptReceipt, type InferenceRequestReceipt } from "@read-aware/core";
import type { PluginLifecycleController } from "./plugin-lifecycle";

type Entry = { receipt: InferenceRequestReceipt; cancel?: () => void };

/** A small metadata ledger independent of the cancellable ask RPC. */
export class PluginInferenceReceipts {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly lifecycle: PluginLifecycleController) {
    lifecycle.signal.addEventListener("abort", () => this.entries.clear(), { once: true });
  }

  private id(value: unknown): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
      throw new AppError("plugin/invalid-argument", "Invalid inference request ID");
    }
    return value;
  }

  begin(id: string, cancel: () => void) {
    this.lifecycle.assertActive("services.llm.ask");
    this.id(id);
    if (this.entries.has(id)) throw new AppError("plugin/invalid-argument", "Inference request ID is already retained");
    for (const [key, entry] of this.entries) {
      if (this.entries.size < 64) break;
      if (entry.receipt.settled) this.entries.delete(key);
    }
    if (this.entries.size >= 64) throw new AppError("ai/busy", "Inference receipt capacity is occupied");
    const now = new Date().toISOString();
    const entry: Entry = { cancel, receipt: { requestId: id, revision: 0, status: "running", settled: false,
      createdAt: now, updatedAt: now, errorCode: null, attempts: [] } };
    this.entries.set(id, entry);
    const change = (patch: Partial<InferenceRequestReceipt>) => {
      if (this.entries.get(id) !== entry) return;
      entry.receipt = { ...entry.receipt, ...patch, revision: entry.receipt.revision + 1, updatedAt: new Date().toISOString() };
    };
    return {
      attempt: (receipt: InferenceAttemptReceipt) => change({ attempts: [...entry.receipt.attempts, structuredClone(receipt)] }),
      finish: (error?: unknown) => {
        entry.cancel = undefined;
        const code = error === undefined ? null : errorCode(error) ?? "ai/unknown";
        change({ status: code === null ? "completed" : code === "ai/request-cancelled" ? "cancelled"
          : code === "ai/request-timeout" ? "timed-out" : "failed", errorCode: code });
      },
      settle: () => change({ settled: true }),
    };
  }

  get(id: string): InferenceRequestReceipt | null {
    this.lifecycle.assertActive("services.llm.getRequest");
    return structuredClone(this.entries.get(this.id(id))?.receipt ?? null);
  }

  list(): InferenceRequestReceipt[] {
    this.lifecycle.assertActive("services.llm.listRequests");
    return [...this.entries.values()].map(entry => structuredClone(entry.receipt));
  }

  cancel(id: string): InferenceRequestReceipt | null {
    this.lifecycle.assertActive("services.llm.cancelRequest");
    const entry = this.entries.get(this.id(id));
    if (!entry) return null;
    if (entry.receipt.status === "running") entry.cancel?.();
    return structuredClone(entry.receipt);
  }
}
