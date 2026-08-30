/**
 * The engine's local side bound to Tauri IPC — outbox reads and
 * acknowledgements, the merge entry point, cursors, and blob bytes. Every
 * command here lands in `storage/sync.rs` / `storage/events.rs`, which the
 * Rust suite covers; this file stays a translation layer with nothing to test
 * but names.
 */
import { invoke } from "../ipc";
import type { HlcStamp } from "@read-aware/core";
import { getDesktopBlob, openDesktopBlobWriter, putDesktopBlob } from "../blob-store";
import type { PlainEvent } from "../sync-envelope";
import type { MergeReport, SyncLocalStore } from "./sync-engine";

export const EVENTS_FEED = "events";

export function createIpcSyncStore(): SyncLocalStore {
  return {
    outboxEvents: (limit) => invoke<PlainEvent[]>("sync_outbox_events", { limit }),
    markEventsPushed: (assigned) => invoke("sync_mark_events_pushed", { assigned }),
    markEventsFailed: (eventIds, error) =>
      invoke("sync_mark_events_failed", { eventIds, error }),
    applyRemote: (events) => invoke<MergeReport>("apply_remote_events", { events }),
    stageRemote: (events) => invoke<number>("stage_remote_events", { events }),
    finalizeStaged: async () => {
      await invoke("finalize_staged_events");
    },
    async eventsCursor() {
      const cursor = await invoke<{ remoteCursor: string | null } | null>("sync_cursor_get", {
        feed: EVENTS_FEED,
      });
      const parsed = Number(cursor?.remoteCursor ?? "0");
      return Number.isFinite(parsed) ? parsed : 0;
    },
    setEventsCursor: (cursor: number, hlc: HlcStamp | null) =>
      invoke("sync_cursor_set", {
        cursor: { feedName: EVENTS_FEED, remoteCursor: String(cursor), hlc },
      }),
    outboxBlobs: (limit) => invoke<Array<{ key: string }>>("sync_outbox_blobs", { limit }),
    markBlobsPushed: (keys) => invoke("sync_mark_blobs_pushed", { keys }),
    markBlobsFailed: (keys, error) => invoke("sync_mark_blobs_failed", { keys, error }),
    markBlobsRejected: (keys, error) => invoke("sync_mark_blobs_rejected", { keys, error }),
    readBlob: (key) => getDesktopBlob(key),
    async writeBlob(key, bytes) {
      await putDesktopBlob(key, bytes);
    },
    async openBlobWriter(key) {
      const writer = await openDesktopBlobWriter(key);
      return {
        append: (bytes) => writer.append(bytes),
        commit: async () => {
          await writer.commit();
        },
        abort: () => writer.abort(),
      };
    },
    touch: (kind) => invoke("sync_profile_touch", { field: kind }),
  };
}

export type SyncProfile = {
  syncEnabled: boolean;
  remoteAccountId: string | null;
  encryptionKeyRef: string | null;
  lastPushAt: string | null;
  lastPullAt: string | null;
};

export const getSyncProfile = () => invoke<SyncProfile>("sync_profile_get");
export const setSyncProfile = (profile: SyncProfile) => invoke("sync_profile_set", { profile });

/**
 * Bind the local push/pull bookkeeping to this account — a connect to a
 * DIFFERENT account resets it wholesale (every event and blob re-enters the
 * outbox, the pull cursor rewinds), because "already pushed" was only ever
 * true of the previous account's mailbox. Resolves to whether a reset ran.
 */
export const adoptSyncAccount = (accountId: string) =>
  invoke<boolean>("sync_adopt_account", { accountId });
