/**
 * Live sync status + backlog for the progress surfaces (header indicator,
 * Data & Sync panel). The snapshot is the scheduler's; the backlog ("what
 * still owes the relay a push") is a store count, polled only while a
 * consumer is actually looking at it.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../../platform/environment";
import {
  getSyncStatusSnapshot,
  subscribeSyncStatus,
} from "../../../platform/sync/sync-scheduler";

export function useSyncStatus() {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatusSnapshot);
}

export type SyncBacklog = { events: number; blobs: number };

const BACKLOG_POLL_MS = 2_000;

/**
 * Outbox counts while `active` (a popover open, the settings panel mounted).
 * Polls at a human pace during a running cycle so the numbers drain live;
 * otherwise refreshes once per activation and after each cycle completes.
 */
export function useSyncBacklog(active: boolean): SyncBacklog | null {
  const status = useSyncStatus();
  const [backlog, setBacklog] = useState<SyncBacklog | null>(null);
  const syncing = status.state === "syncing";

  useEffect(() => {
    if (!active || !isTauri()) return;
    let cancelled = false;
    const load = async () => {
      try {
        const counts = await invoke<SyncBacklog>("sync_outbox_counts");
        if (!cancelled) setBacklog(counts);
      } catch (error) {
        console.warn("[sync] outbox count failed", error);
      }
    };
    void load();
    if (!syncing) return () => { cancelled = true; };
    const timer = window.setInterval(() => void load(), BACKLOG_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // lastSyncAt: one refresh after a cycle lands, so idle numbers are final.
  }, [active, syncing, status.lastSyncAt]);

  return backlog;
}
