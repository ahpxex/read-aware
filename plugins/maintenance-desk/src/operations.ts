export type Operation = "connection" | "backupExport" | "backupImport" | "reportExport" | "reportSend" | "verify"
  | "syncNow" | "syncConnect" | "syncDisconnect" | "syncDelete" | "syncUpgrade" | "syncBilling";
export type Outcome = { status: "responded" | "emptyResponse" | "exported" | "imported" | "sent" | "cancelled" | "consistent" | "drifted"
  | "syncCycleCompleted" | "syncAlreadyRunning" | "syncFlowCompleted" | "syncExternalOpened";
  counts?: { events: number; tables: number; liveRows: number; replayRows: number } };
export type Entry = { id: number; operation: Operation; timestamp: string;
  phase: "pending" | "cancelling" | "cancelled" | "complete" | "failed"; outcome?: Outcome; errorCode?: string };

export function failureCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" && /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/.test(code) ? code : "ipc/unknown";
}

/** Host navigation closes the view, not the activation-owned receipt wait. */
export class Operations {
  private entries: Entry[] = [];
  private pending?: { entry: Entry; controller: AbortController };
  private listeners = new Set<() => void>();
  private sequence = 0;
  private retired = false;

  snapshot(): Entry[] {
    return this.entries.map(entry => ({ ...entry, ...(entry.outcome ? { outcome: {
      ...entry.outcome, ...(entry.outcome.counts ? { counts: { ...entry.outcome.counts } } : {}),
    } } : {}) }));
  }
  get busy() { return Boolean(this.pending); }
  subscribe(listener: () => void) {
    if (!this.retired) this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }
  private emit() { for (const listener of this.listeners) listener(); }

  start(operation: Operation, run: (signal: AbortSignal) => Promise<Outcome>): boolean {
    if (this.retired || this.pending) return false;
    const entry: Entry = { id: ++this.sequence, operation, timestamp: new Date().toISOString(), phase: "pending" };
    const controller = new AbortController();
    this.pending = { entry, controller };
    this.entries = [entry, ...this.entries].slice(0, 20);
    this.emit();
    void (async () => {
      try {
        controller.signal.throwIfAborted();
        const outcome = await run(controller.signal);
        if (this.retired) return;
        if (controller.signal.aborted || outcome.status === "cancelled") entry.phase = "cancelled";
        else { entry.phase = "complete"; entry.outcome = outcome; }
      } catch (error) {
        if (this.retired) return;
        entry.phase = controller.signal.aborted ? "cancelled" : "failed";
        if (entry.phase === "failed") entry.errorCode = failureCode(error);
      } finally {
        if (this.pending?.entry === entry) this.pending = undefined;
        if (!this.retired) this.emit();
      }
    })();
    return true;
  }
  cancel(id: number) {
    if (!this.pending || this.pending.entry.id !== id || this.pending.controller.signal.aborted) return;
    this.pending.entry.phase = "cancelling";
    this.pending.controller.abort();
    this.emit();
  }
  clear() {
    this.entries = this.entries.filter(entry => entry === this.pending?.entry);
    this.emit();
  }
  dispose() {
    this.retired = true;
    this.listeners.clear();
    this.pending?.controller.abort();
    this.entries = [];
  }
}
