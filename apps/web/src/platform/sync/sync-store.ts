/**
 * The engine's local side bound to Tauri IPC — outbox reads and
 * acknowledgements, the merge entry point, cursors, and blob bytes. Every
 * command here lands in `storage/sync.rs` / `storage/events.rs`, which the
 * Rust suite covers; this file stays a translation layer with nothing to test
 * but names.
 */
import { invoke } from "../ipc";
import { localDeviceId } from "../domain-events";
import type { HlcStamp } from "@read-aware/core";
import { getDesktopBlob, openDesktopBlobWriter, putDesktopBlob } from "../blob-store";
import type { PlainEvent } from "../sync-envelope";
import type {
  BackfillReport,
  BackfillStatus,
  CheckpointInfo,
  MergeReport,
  SyncLocalStore,
  SyncOutboxCounts,
} from "./sync-engine";

export const EVENTS_FEED = "events";

export function createIpcSyncStore(): SyncLocalStore {
  return {
    outboxEvents: (limit) => invoke<PlainEvent[]>("sync_outbox_events", { limit }),
    markEventsPushed: (assigned) => invoke("sync_mark_events_pushed", { assigned }),
    markEventsFailed: (eventIds, error) =>
      invoke("sync_mark_events_failed", { eventIds, error }),
    applyRemote: (events, seqs) =>
      invoke<MergeReport>("apply_remote_events", { events, seqs: seqs ?? null }),
    stageRemote: (events, seqs) =>
      invoke<number>("stage_remote_events", { events, seqs: seqs ?? null }),
    finalizeStaged: async () => {
      await invoke("finalize_staged_events");
    },
    outboxCounts: () => invoke<SyncOutboxCounts>("sync_outbox_counts"),
    unverifiedEvents: (limit) => invoke<string[]>("sync_unverified_events", { limit }),
    resolveEvents: (known, missing) => invoke("sync_resolve_events", { known, missing }),
    assumeEventsMissing: () => invoke<number>("sync_assume_events_missing"),
    unverifiedBlobs: (limit) =>
      invoke<Array<{ key: string; byteSize: number | null }>>("sync_unverified_blobs", { limit }),
    resolveBlobs: (present, absent) => invoke("sync_resolve_blobs", { present, absent }),
    assumeBlobsMissing: () => invoke<number>("sync_assume_blobs_missing"),
    schemaVersion: () => invoke<number>("checkpoint_schema_version"),
    maintainCheckpoint: () => invoke<CheckpointInfo | null>("checkpoint_maintain"),
    preparePublishCheckpoint: () => invoke<CheckpointInfo>("checkpoint_prepare_publish"),
    markCheckpointPublished: (id) => invoke("checkpoint_mark_published", { id }),
    restoreBootstrapCheckpoint: (blobKey) =>
      invoke<CheckpointInfo>("checkpoint_restore_bootstrap", { blobKey }),
    backfillStatus: () => invoke<BackfillStatus | null>("sync_backfill_status"),
    backfillEvents: (events, seqs) =>
      invoke<BackfillReport>("sync_backfill_events", { events, seqs }),
    settleBackfill: () => invoke<BackfillStatus | null>("sync_backfill_settle"),
    deviceId: () => localDeviceId(),
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
