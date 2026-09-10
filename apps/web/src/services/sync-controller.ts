import { AppError, type AccountResponse, type HostSyncAccount, type HostSyncPort, type HostSyncSnapshot } from "@read-aware/core";
import type { SyncStatusSnapshot } from "../platform/sync/sync-scheduler";

type Adapter = {
  supported(): boolean; busy(): boolean; epoch(): string; status(): SyncStatusSnapshot;
  subscribe(handler: () => void): () => void;
  backlog: HostSyncPort["backlog"]; account(): Promise<AccountResponse>;
  run(): Promise<unknown | null>; openSettings(signal?: AbortSignal): Promise<unknown>;
  connectionOptions: HostSyncPort["connectionOptions"];
  requestFlow: HostSyncPort["requestFlow"];
};
function quota(value: number | null): number | null {
  if (value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0)) return value;
  throw new AppError("sync/server", "Invalid account quota response");
}
function count(value: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  throw new AppError("sync/server", "Invalid sync count");
}

export class HostSyncService implements HostSyncPort {
  private revision = 0;
  private listeners = new Set<() => void>();
  private unsubscribe: () => void;
  constructor(private adapter: Adapter, private report: (error: unknown) => void) {
    this.unsubscribe = adapter.subscribe(() => {
      this.revision++;
      for (const listener of this.listeners) listener();
    });
  }
  dispose() { this.unsubscribe(); this.listeners.clear(); }
  async snapshot(): Promise<HostSyncSnapshot> {
    const state = this.adapter.status(), p = state.progress, last = state.lastCycle;
    return { revision: this.revision, supported: this.adapter.supported(), connectionBusy: this.adapter.busy(),
      state: state.state, connected: state.accountConnected, backend: state.backend,
      lastSyncAt: state.lastSyncAt, lastErrorCode: state.lastErrorCode,
      progress: p ? { phase: p.phase, pulled: p.pulled, pushed: p.pushed, verified: p.verified,
        backfilled: p.backfilled, blobsDone: p.blobsDone, blobsTotal: p.blobsTotal } : null,
      cycleStartBacklog: state.cycleTotals ? { events: state.cycleTotals.events, blobs: state.cycleTotals.blobs } : null,
      lastCycle: last ? { pulled: last.pulled, pushed: last.pushed, blobs: last.blobs, backfilled: last.backfilled ?? 0 } : null,
      backfillRemaining: state.backfillRemaining };
  }
  observe(handler: (snapshot: HostSyncSnapshot) => unknown) {
    if (this.listeners.size >= 64) throw new AppError("ui/observer-limit", "Too many sync observers");
    let stopped = false, running = false, dirty = false;
    const deliver = async () => {
      dirty = true; if (running || stopped) return;
      running = true;
      try {
        do {
          dirty = false;
          try { const snapshot = await this.snapshot(); if (!stopped) await handler(snapshot); }
          catch (error) { this.report(error); }
        } while (dirty && !stopped);
      } finally { running = false; }
    };
    const notify = () => { void deliver(); };
    this.listeners.add(notify); notify();
    return () => { stopped = true; this.listeners.delete(notify); };
  }
  async backlog(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!this.adapter.supported()) throw new AppError("ui/unavailable", "Sync storage requires desktop");
    const result = await this.adapter.backlog(signal);
    signal?.throwIfAborted();
    return { events: count(result.events), blobs: count(result.blobs) };
  }
  async account(signal?: AbortSignal): Promise<HostSyncAccount | null> {
    signal?.throwIfAborted();
    const before = this.adapter.status();
    if (!this.adapter.supported() || !before.accountConnected || before.backend !== "relay") return null;
    const epoch = this.guard(signal), account = await this.adapter.account();
    this.guard(signal, epoch);
    if (!account || typeof account !== "object" || Array.isArray(account)
      || !["free", "sync", "pro", "max", "staff"].includes(account.tier) || typeof account.hasBilling !== "boolean") throw new AppError("sync/server", "Invalid account response");
    return { tier: account.tier, hasBilling: account.hasBilling, blobBytesUsed: count(account.blobBytesUsed),
      eventsUsed: count(account.eventsUsed), aiCreditsUsed: count(account.aiCreditsUsed),
      limits: { maxBlobBytes: quota(account.limits?.maxBlobBytes), maxAccountBlobBytes: quota(account.limits?.maxAccountBlobBytes),
        maxAccountEvents: quota(account.limits?.maxAccountEvents), aiMonthlyCredits: quota(account.limits?.aiMonthlyCredits) } };
  }
  async requestSync(signal?: AbortSignal) {
    const epoch = this.guard(signal);
    const result = await this.adapter.run();
    this.guard(signal, epoch);
    return { status: result === null ? "already-running" as const : "completed" as const, snapshot: await this.snapshot() };
  }
  async openSettings(signal?: AbortSignal) {
    signal?.throwIfAborted(); await this.adapter.openSettings(signal); signal?.throwIfAborted();
    return { status: "opened" as const, surface: "dataSync" as const };
  }
  async connectionOptions() {
    if (!this.adapter.supported()) return [];
    return this.adapter.connectionOptions();
  }
  requestFlow(...args: Parameters<HostSyncPort["requestFlow"]>) {
    if (!this.adapter.supported()) return Promise.reject(new AppError("ui/unavailable", "Sync account flows require desktop"));
    return this.adapter.requestFlow(...args);
  }
  private guard(signal?: AbortSignal, expected?: string): string {
    signal?.throwIfAborted();
    const state = this.adapter.status();
    if (expected !== undefined && expected !== this.adapter.epoch()) throw new AppError("ui/superseded", "Sync connection changed during the request");
    if (!this.adapter.supported() || this.adapter.busy() || !state.accountConnected || state.state === "disabled") throw new AppError("ui/unavailable", "Sync is not connected or connection management is in progress");
    if (state.state === "unauthenticated") throw new AppError("sync/unauthorized", "Reconnect before syncing");
    return this.adapter.epoch();
  }
}
