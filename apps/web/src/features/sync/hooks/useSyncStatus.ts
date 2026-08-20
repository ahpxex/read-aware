/**
 * Live sync status + backlog for the progress surfaces (header indicator,
 * Data & Sync panel). The snapshot is the scheduler's; the backlog ("what
 * still owes the relay a push") is a store count, polled only while a
 * consumer is actually looking at it.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../../platform/environment";
import { createLogger } from "../../../platform/logger";
import {
  getSyncStatusSnapshot,
  subscribeSyncStatus,
} from "../../../platform/sync/sync-scheduler";

const log = createLogger("sync");

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
        log.warn("outbox count failed", error);
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

/** One book the relay doesn't hold yet, from `sync_book_backlog` (sync.rs). */
export type SyncBookBacklogRow = {
  bookId: string;
  title: string;
  byteSize: number | null;
  pushState: "pending" | "failed" | "rejected";
  lastError: string | null;
  /** false = a manifest-only ghost: some OTHER device owes this upload. */
  localBytes: boolean;
};

/**
 * Per-book upload backlog for the Data & Sync panel — same activation and
 * pacing rules as the counts above, one query heavier.
 */
export function useSyncBookBacklog(active: boolean): SyncBookBacklogRow[] | null {
  const status = useSyncStatus();
  const [rows, setRows] = useState<SyncBookBacklogRow[] | null>(null);
  const syncing = status.state === "syncing";

  useEffect(() => {
    if (!active || !isTauri()) return;
    let cancelled = false;
    const load = async () => {
      try {
        const backlog = await invoke<SyncBookBacklogRow[]>("sync_book_backlog");
        if (!cancelled) setRows(backlog);
      } catch (error) {
        log.warn("book backlog failed", error);
      }
    };
    void load();
    if (!syncing) return () => { cancelled = true; };
    const timer = window.setInterval(() => void load(), BACKLOG_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active, syncing, status.lastSyncAt]);

  return rows;
}
