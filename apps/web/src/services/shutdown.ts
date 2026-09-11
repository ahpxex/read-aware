import { AppError, errorCode } from "@read-aware/core";
import { createLogger } from "../platform/logger";

export type ShutdownPhase = "settle" | "persist";
export type ShutdownOwnerReport = { name: string; phase: ShutdownPhase; status: "flushed" | "failed" | "timed-out"; code?: string };
export type ShutdownReceipt = { status: "ready" | "degraded"; owners: ShutdownOwnerReport[]; elapsedMs: number };
type Owner = { name: string; phase: ShutdownPhase; flush: (signal: AbortSignal) => Promise<void> };
export const SHUTDOWN_DEADLINE_MS = 8_000;

/** One coordinated flush before the process goes away. Owners settle in-flight work first
 * (reading traces, plugin quiescence, dispatched events), then persistence queues drain.
 * A slow or failing owner is reported, never allowed to trap the user in a window that will not close. */
export class ShutdownCoordinator {
  private readonly owners = new Map<symbol, Owner>();
  private inFlight: Promise<ShutdownReceipt> | undefined;
  private receipt: ShutdownReceipt | undefined;

  constructor(private readonly report: (message: string, error?: unknown) => void, private readonly now: () => number = Date.now) {}

  register(name: string, phase: ShutdownPhase, flush: (signal: AbortSignal) => Promise<void>): () => void {
    if (typeof name !== "string" || !name.trim() || typeof flush !== "function" || phase !== "settle" && phase !== "persist") {
      throw new AppError("ui/invalid-target", "Invalid shutdown owner");
    }
    if (this.owners.size >= 64) throw new AppError("ui/observer-limit", "Too many shutdown owners");
    const key = Symbol(name);
    this.owners.set(key, { name, phase, flush });
    return () => { this.owners.delete(key); };
  }

  /** The last completed preparation, if any. Owners registered later are not covered by it. */
  get prepared(): ShutdownReceipt | undefined { return this.receipt; }

  /** Shared while in flight; a second caller joins the same preparation. */
  prepare(options: { deadlineMs?: number; signal?: AbortSignal } = {}): Promise<ShutdownReceipt> {
    if (this.inFlight) return this.inFlight;
    const deadlineMs = options.deadlineMs ?? SHUTDOWN_DEADLINE_MS;
    if (!Number.isFinite(deadlineMs) || deadlineMs < 0) return Promise.reject(new AppError("ui/invalid-target", "Invalid shutdown deadline"));
    const run = this.run(deadlineMs, options.signal);
    this.inFlight = run;
    void run.finally(() => { if (this.inFlight === run) this.inFlight = undefined; }).catch(() => {});
    return run;
  }

  private async run(deadlineMs: number, signal?: AbortSignal): Promise<ShutdownReceipt> {
    signal?.throwIfAborted();
    const started = this.now(), owners = [...this.owners.values()], reports: ShutdownOwnerReport[] = [];
    const remaining = () => Math.max(0, deadlineMs - (this.now() - started));
    for (const phase of ["settle", "persist"] as const) {
      const batch = owners.filter(owner => owner.phase === phase);
      if (!batch.length) continue;
      const controller = new AbortController();
      const onCaller = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", onCaller, { once: true });
      const timer = setTimeout(() => controller.abort(new AppError("ui/unavailable", "Shutdown deadline reached")), remaining());
      try {
        await Promise.all(batch.map(async owner => {
          let status: ShutdownOwnerReport["status"] = "flushed", code: string | undefined;
          try {
            await Promise.race([owner.flush(controller.signal), new Promise<never>((_, reject) => {
              controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
              if (controller.signal.aborted) reject(controller.signal.reason);
            })]);
          } catch (error) {
            const timedOut = controller.signal.aborted && signal?.aborted !== true;
            status = timedOut ? "timed-out" : "failed";
            code = errorCode(error) ?? "internal";
            this.report(`Shutdown owner ${owner.name} ${status}`, error);
          }
          reports.push({ name: owner.name, phase, status, ...(code === undefined ? {} : { code }) });
        }));
      } finally { clearTimeout(timer); signal?.removeEventListener("abort", onCaller); }
      // A caller abort ends preparation without a receipt; a deadline only degrades it.
      signal?.throwIfAborted();
    }
    const receipt: ShutdownReceipt = { status: reports.every(report => report.status === "flushed") ? "ready" : "degraded", owners: reports, elapsedMs: this.now() - started };
    this.receipt = receipt;
    return receipt;
  }
}

const log = createLogger("shutdown");
export const hostShutdown = new ShutdownCoordinator((message, error) => log.warn(message, error));
