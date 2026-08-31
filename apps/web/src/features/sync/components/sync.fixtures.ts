/**
 * Sync status snapshots for the story files.
 *
 * The real snapshots come from a module-level singleton the scheduler owns, so
 * they are written out here instead — one per state the surfaces have to
 * render. Story-only; nothing in the product imports this.
 */
import type { SyncCycleProgress } from "../../../platform/sync/sync-engine";
import type { SyncStatusSnapshot } from "../../../platform/sync/sync-scheduler";

/** A fixed instant, so "last synced at" never drifts between renders. */
export const LAST_SYNC = new Date(2026, 5, 28, 20, 14).getTime();

const base: SyncStatusSnapshot = {
  state: "idle",
  accountConnected: true,
  backend: "relay",
  transportRef: null,
  lastSyncAt: LAST_SYNC,
  lastErrorCode: null,
  progress: null,
  cycleTotals: null,
  lastCycle: { pulled: 12, pushed: 4, blobs: 1 },
};

const emptyProgress: SyncCycleProgress = {
  phase: "pull",
  pulled: 0,
  pushed: 0,
  blobsDone: 0,
  blobsTotal: 0,
  blobKey: null,
  blobDirection: null,
  blobPartsDone: 0,
  blobPartsTotal: 0,
};

export function snapshot(patch: Partial<SyncStatusSnapshot> = {}): SyncStatusSnapshot {
  return { ...base, ...patch };
}

/** Settled, with a successful cycle behind it. */
export const idle = snapshot();

/** Connected but never synced — no "last synced" time to show yet. */
export const neverSynced = snapshot({ lastSyncAt: null, lastCycle: null });

/**
 * Pulling. The relay never says how much remains, so this phase is honestly
 * indeterminate: no fraction, no bar.
 */
export const pulling = snapshot({
  state: "syncing",
  progress: { ...emptyProgress, phase: "pull", pulled: 37 },
});

/** Pushing, where the outbox size makes an honest denominator. */
export const pushing = snapshot({
  state: "syncing",
  cycleTotals: { events: 120, blobs: 2 },
  progress: { ...emptyProgress, phase: "push", pulled: 40, pushed: 76 },
});

/** Uploading a book file, chunked — the bar moves per part, not per file. */
export const uploadingBook = snapshot({
  state: "syncing",
  cycleTotals: { events: 120, blobs: 3 },
  progress: {
    ...emptyProgress,
    phase: "blobs",
    pulled: 40,
    pushed: 120,
    blobsDone: 1,
    blobsTotal: 3,
    blobKey: "bookfile:book-pale-fire",
    blobDirection: "up",
    blobPartsDone: 3,
    blobPartsTotal: 8,
  },
});

/** Downloading a book from another device. */
export const downloadingBook = snapshot({
  state: "syncing",
  cycleTotals: { events: 0, blobs: 2 },
  progress: {
    ...emptyProgress,
    phase: "blobs",
    blobsDone: 0,
    blobsTotal: 2,
    blobKey: "bookfile:book-sea",
    blobDirection: "down",
    blobPartsDone: 5,
    blobPartsTotal: 6,
  },
});

/** A lazy blob fetch outside a cycle: part counters, no cycle denominator. */
export const singleBlobNoTotals = snapshot({
  state: "syncing",
  progress: {
    ...emptyProgress,
    phase: "blobs",
    blobKey: "bookfile:book-annals",
    blobDirection: "down",
    blobPartsDone: 2,
    blobPartsTotal: 9,
  },
});

/** The cycle failed; the relay's own message is what surfaces. */
export const failed = snapshot({
  state: "error",
  lastErrorCode: "sync/quota",
});

/** A failure with no message to show — the generic wording stands in. */
export const failedWithoutMessage = snapshot({ state: "error", lastErrorCode: null });

/** The relay rejected the session (401). Terminal: no retry heals it. */
export const unauthenticated = snapshot({ state: "unauthenticated" });

/** No account connected at all. */
export const disabled = snapshot({
  state: "disabled",
  accountConnected: false,
  backend: null,
  transportRef: null,
  lastSyncAt: null,
  lastCycle: null,
});

/** Work still owed to the relay, as the popover polls it. */
export const backlog = { events: 214, blobs: 3 };
