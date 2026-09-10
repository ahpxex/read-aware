import type { SyncTier, SyncTierLimits } from "./sync";

export type HostSyncSnapshot = {
  revision: number; supported: boolean; connectionBusy: boolean;
  state: "disabled" | "idle" | "syncing" | "error" | "unauthenticated";
  connected: boolean; backend: "relay" | "transport" | null;
  lastSyncAt: number | null; lastErrorCode: string | null;
  progress: { phase: "bootstrap" | "pull" | "verify" | "push" | "blobs" | "backfill" | "checkpoint";
    pulled: number; pushed: number; verified: number; backfilled: number; blobsDone: number; blobsTotal: number } | null;
  cycleStartBacklog: { events: number; blobs: number } | null;
  lastCycle: { pulled: number; pushed: number; blobs: number; backfilled: number } | null;
  backfillRemaining: number;
};
export type HostSyncAccount = {
  tier: SyncTier; hasBilling: boolean; blobBytesUsed: number; eventsUsed: number;
  aiCreditsUsed: number; limits: SyncTierLimits;
};
export type HostSyncReceipt = { status: "completed" | "already-running"; snapshot: HostSyncSnapshot };
export type HostSyncPort = {
  snapshot(): Promise<HostSyncSnapshot>;
  backlog(signal?: AbortSignal): Promise<{ events: number; blobs: number }>;
  /** Explicit remote read. No email, account ID, keys, session or billing ticket. */
  account(signal?: AbortSignal): Promise<HostSyncAccount | null>;
  /** Uses the configured scheduler. Caller cancellation cannot stop a shared sync or undo its writes. */
  requestSync(signal?: AbortSignal): Promise<HostSyncReceipt>;
  /** Opens the host Data & Sync page, not an automatic login, disconnect or purchase. */
  openSettings(signal?: AbortSignal): Promise<{ status: "opened"; surface: "dataSync" }>;
};
