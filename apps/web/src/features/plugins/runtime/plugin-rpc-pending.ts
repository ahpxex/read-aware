import { AppError } from "@read-aware/core";

type Pending = {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  cleanup(): void;
};

/** One direction of a realm's RPCs. Every accepted call has exactly one terminal outcome. */
export class PluginRpcPending {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private closed: Error | undefined;

  constructor(private readonly timeoutMs = 120_000, private readonly limit = 256) {}

  get size(): number { return this.pending.size; }

  call(
    send: (id: number) => void,
    options: { signal?: AbortSignal; cancel?: (id: number) => void } = {},
  ): Promise<unknown> {
    if (this.closed) return Promise.reject(this.closed);
    if (options.signal?.aborted) return Promise.reject(options.signal.reason ?? new AppError("plugin/cancelled", "Plugin call cancelled"));
    if (this.pending.size >= this.limit) return Promise.reject(new AppError("plugin/busy", "Too many pending plugin calls"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let sent = false;
      const cancel = (error: unknown) => {
        if (!this.settle(id, false, error)) return;
        if (sent) options.cancel?.(id);
      };
      const onAbort = () => cancel(options.signal?.reason ?? new AppError("plugin/cancelled", "Plugin call cancelled"));
      const timeout = setTimeout(() => cancel(new AppError("plugin/timeout", "Plugin call timed out", { retryable: true })), this.timeoutMs);
      this.pending.set(id, {
        resolve, reject,
        cleanup: () => { clearTimeout(timeout); options.signal?.removeEventListener("abort", onAbort); },
      });
      options.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        sent = true;
        send(id);
      } catch (error) {
        this.settle(id, false, error);
      }
    });
  }

  settle(id: number, ok: boolean, value: unknown): boolean {
    const pending = this.pending.get(id);
    if (!pending) return false;
    this.pending.delete(id);
    pending.cleanup();
    if (ok) pending.resolve(value); else pending.reject(value);
    return true;
  }

  failAll(error: Error): void {
    for (const id of this.pending.keys()) this.settle(id, false, error);
  }

  close(error: Error): void {
    this.closed = error;
    this.failAll(error);
  }
}
