import { AppError, errorCode, normalizeHostWindowRequest, type HostWindowObservation,
  type HostWindowPort, type HostWindowRequest, type HostWindowSnapshot, type HostWindowState } from "@read-aware/core";

export type WindowAdapter = {
  supported(): boolean;
  read(): Promise<HostWindowState>;
  apply(request: HostWindowRequest, signal?: AbortSignal): Promise<void>;
  watch(changed: () => void): Promise<() => void>;
};

/** Main-window intents only. A native acknowledgement is not an animation receipt. */
export class HostWindowService implements HostWindowPort {
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private revision = 0;
  private previous = "";
  private reading?: Promise<HostWindowSnapshot>;
  private listeners = new Set<() => void>();
  private stopWatch?: () => void;
  private watchGeneration = 0;

  constructor(private adapter: WindowAdapter, private report: (error: unknown) => void) {}

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    if (this.queued >= 32) return Promise.reject(new AppError("ui/unavailable", "Too many pending window requests"));
    this.queued++;
    const result = this.tail.then(run).finally(() => { this.queued--; });
    this.tail = result.catch(() => {}); // Failure must not poison later independent intents.
    return result;
  }

  private async read(): Promise<HostWindowSnapshot> {
    const state = this.adapter.supported() ? { supported: true as const, ...await this.adapter.read() } : { supported: false as const };
    const key = JSON.stringify(state);
    if (key !== this.previous) { this.previous = key; this.revision++; }
    return { ...state, revision: this.revision };
  }

  async snapshot(signal?: AbortSignal): Promise<HostWindowSnapshot> {
    signal?.throwIfAborted();
    if (!this.reading) {
      const read = this.enqueue(() => this.read());
      this.reading = read;
      void read.finally(() => { if (this.reading === read) this.reading = undefined; }).catch(() => {}); // Caller receives the read failure.
    }
    const value = await this.reading;
    signal?.throwIfAborted();
    return { ...value };
  }

  control(input: HostWindowRequest, signal?: AbortSignal) {
    const request = normalizeHostWindowRequest(input);
    signal?.throwIfAborted();
    return this.enqueue(async () => {
      signal?.throwIfAborted();
      if (!this.adapter.supported()) throw new AppError("ui/unavailable", "Window controls require the desktop app");
      try {
        await this.adapter.apply(request, signal);
        signal?.throwIfAborted();
        const snapshot = await this.read();
        signal?.throwIfAborted();
        return { status: "requested" as const, snapshot };
      } finally { this.notify(); }
    });
  }

  private notify = () => { for (const listener of this.listeners) listener(); };

  observe(handler: (value: HostWindowObservation) => unknown): () => void {
    if (typeof handler !== "function") throw new AppError("ui/invalid-target", "Expected window observer");
    if (this.listeners.size >= 64) throw new AppError("ui/observer-limit", "Too many window observers");
    let stopped = false, running = false, dirty = false, last = "";
    const deliver = async () => {
      dirty = true;
      if (running || stopped) return;
      running = true;
      try {
        do {
          dirty = false;
          let value: HostWindowObservation;
          try { value = { status: "ready", snapshot: await this.snapshot() }; }
          catch (error) { this.report(error); value = { status: "error", code: errorCode(error) ?? "ipc/unknown" }; }
          const key = JSON.stringify(value);
          if (!stopped && key !== last) {
            last = key;
            try { await handler(value); } catch (error) { this.report(error); }
          }
        } while (dirty && !stopped);
      } finally { running = false; }
    };
    const notify = () => { void deliver(); };
    this.listeners.add(notify);
    if (this.listeners.size === 1 && this.adapter.supported()) {
      const generation = ++this.watchGeneration;
      void this.adapter.watch(this.notify).then(stop => {
        if (generation !== this.watchGeneration || !this.listeners.size) stop();
        else { this.stopWatch = stop; this.notify(); }
      }).catch(error => this.report(error));
    }
    notify();
    return () => {
      if (stopped) return;
      stopped = true; this.listeners.delete(notify);
      if (!this.listeners.size) { this.watchGeneration++; this.stopWatch?.(); this.stopWatch = undefined; }
    };
  }
}
