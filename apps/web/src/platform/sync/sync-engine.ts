/**
 * The sync engine: push the event outbox, pull the relay feed, move blobs —
 * as pure orchestration over injected ports. No timers, no `invoke`, no
 * `fetch` in here: `sync-store.ts` binds the local side to Tauri IPC,
 * `relay-client.ts` binds the remote side to HTTP, and the scheduler owns
 * cadence. That split is what lets the whole engine run under bun:test with
 * two fake devices talking through an in-memory relay.
 *
 * Merge pipeline (docs/sync-engine.md §3): pull page → observe every HLC stamp
 * (clock first — an event must never be applied by a clock that hasn't seen
 * its stamp) → decrypt → `apply_remote_events` (skips the outbox; replays when
 * events land behind the frontier) → advance the cursor. A multi-page backlog
 * behind the frontier switches to stage-then-finalize so the whole pull costs
 * one replay instead of one per page (§11 攒页重放). Push and pull never
 * conflict-resolve anything: projections are a pure function of the log.
 */
import {
  ERR_SYNC_FILE_TOO_LARGE,
  ERR_SYNC_NO_LOCAL_BYTES,
  ERR_SYNC_QUOTA,
  ERR_SYNC_REJECTED,
  errorCode,
  type HlcStamp,
} from "@read-aware/core";
import { createLogger } from "../logger";
import {
  BLOB_CHUNK_BYTES,
  decodeBlobHead,
  openBlob,
  openBlobPart,
  openEvent,
  sealBlob,
  sealBlobPart,
  sealEvent,
  type PlainEvent,
  type SealedEvent,
} from "../sync-envelope";

export type MergeReport = { appended: number; applied: number; replayed: boolean };

const log = createLogger("sync");

/**
 * Codes a backend may throw to say "this blob will never be accepted" — the
 * transport-side (coded) counterpart of the relay's 4xx statuses. Anything
 * else coded or uncoded is treated as transient and retried.
 */
const PERMANENT_BLOB_CODES: ReadonlySet<string> = new Set([
  ERR_SYNC_QUOTA,
  ERR_SYNC_FILE_TOO_LARGE,
  ERR_SYNC_REJECTED,
]);

/** A refusal the outbox must not retry: an HTTP 4xx from the relay, or a
 *  permanent `sync/*` code from a plugin transport. */
function isPermanentBlobRefusal(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  if (typeof status === "number" && status >= 400 && status < 500) return true;
  const code = errorCode(error);
  return code !== undefined && PERMANENT_BLOB_CODES.has(code);
}

/**
 * Stable code for a blob refusal — this is what lands in
 * `blob_sync_state.last_error` (and thus the per-book backlog UI), so the
 * settings panel can render localized, actionable copy. The backend's raw
 * wording goes to the log at the catch site, never into the row.
 */
function classifyBlobRejection(error: unknown): string {
  const code = errorCode(error);
  if (code !== undefined && PERMANENT_BLOB_CODES.has(code)) return code;
  const status = (error as { status?: number }).status;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 413) {
    return /account blob quota/i.test(message) ? ERR_SYNC_QUOTA : ERR_SYNC_FILE_TOO_LARGE;
  }
  return ERR_SYNC_REJECTED;
}

/** The local (SQLite-over-IPC) side the engine drives. */
export type SyncLocalStore = {
  outboxEvents(limit: number): Promise<PlainEvent[]>;
  markEventsPushed(assigned: Array<[string, number]>): Promise<void>;
  markEventsFailed(ids: string[], error: string): Promise<void>;
  applyRemote(events: PlainEvent[]): Promise<MergeReport>;
  /** Append pulled events to the log WITHOUT applying — the batched half of a
   *  large backlog merge; `finalizeStaged` replays once for all of them. */
  stageRemote(events: PlainEvent[]): Promise<number>;
  /** Replay everything staged (no-op when nothing is). Safe to call anytime. */
  finalizeStaged(): Promise<void>;
  eventsCursor(): Promise<number>;
  setEventsCursor(cursor: number, hlc: HlcStamp | null): Promise<void>;
  outboxBlobs(limit: number): Promise<Array<{ key: string }>>;
  markBlobsPushed(keys: string[]): Promise<void>;
  /** Transient failure (network, 5xx): stays in the outbox for retry. */
  markBlobsFailed(keys: string[], error: string): Promise<void>;
  /** Permanent refusal (4xx: size cap, quota, missing bytes): leaves the outbox. */
  markBlobsRejected(keys: string[], error: string): Promise<void>;
  readBlob(key: string): Promise<Uint8Array | null>;
  writeBlob(key: string, bytes: Uint8Array): Promise<void>;
  /** Incremental local write for chunked downloads: decrypted parts land as
   *  they arrive, so a large book never has to assemble in engine memory. */
  openBlobWriter(key: string): Promise<{
    append(bytes: Uint8Array): Promise<void>;
    commit(): Promise<void>;
    abort(): Promise<void>;
  }>;
  touch(kind: "push" | "pull"): Promise<void>;
};

/** The remote side — the relay's mailbox and shelf. */
export type SyncRelayApi = {
  pushEvents(events: SealedEvent[]): Promise<Record<string, number>>;
  pullEvents(after: number, limit: number): Promise<{ events: SealedEvent[]; next: number }>;
  putBlob(key: string, bytes: Uint8Array): Promise<void>;
  getBlob(key: string): Promise<Uint8Array | null>;
  /** Chunked transport (sync-envelope v2) for blobs over one request's worth. */
  putBlobPart(key: string, index: number, parts: number, bytes: Uint8Array): Promise<void>;
  commitBlob(key: string, parts: number): Promise<void>;
  getBlobPart(key: string, index: number): Promise<Uint8Array>;
};

/**
 * Live counters for the cycle in flight — what the sync indicator and the
 * Data & Sync panel narrate. Counts are cumulative within one `syncOnce`;
 * `blobsTotal` is this PASS's queue (at most `blobBatchSize`), not the whole
 * backlog — the backlog is a store question (`sync_outbox_counts`).
 */
export type SyncCycleProgress = {
  phase: "pull" | "push" | "blobs";
  pulled: number;
  pushed: number;
  blobsDone: number;
  blobsTotal: number;
  /** The blob moving right now (null between blobs) and which way it goes —
   *  the UI resolves `bookfile:<id>` to a title for "syncing <book>…". */
  blobKey: string | null;
  blobDirection: "up" | "down" | null;
  /** Part counters for the blob in flight; 0/0 for a single-request blob. */
  blobPartsDone: number;
  blobPartsTotal: number;
};

export type SyncEngineOptions = {
  store: SyncLocalStore;
  relay: SyncRelayApi;
  /** The E2E master key; null = not connected, every operation refuses. */
  masterKey: () => Uint8Array | null;
  /** The HLC receive rule (platform/domain-events.observeRemoteHlcStamps). */
  observe: (stamps: HlcStamp[]) => void;
  /** Called after every page/batch/blob with the cycle's running counters. */
  onProgress?: (progress: SyncCycleProgress) => void;
  /** Events per push batch / pull page. */
  batchSize?: number;
  /** Blobs attempted per blob pass. */
  blobBatchSize?: number;
  /** Plaintext bytes per sealed part (tests shrink it; production default
   *  BLOB_CHUNK_BYTES). Blobs at or under one chunk ride the v1 single PUT. */
  blobChunkBytes?: number;
};

export type SyncEngine = {
  /** Drain the event outbox. Returns how many events the relay accepted. */
  pushOnce(): Promise<number>;
  /** Pull and merge everything after the cursor. Returns events merged. */
  pullOnce(): Promise<number>;
  /** Upload pending blobs. Returns how many landed; failures are marked, not thrown. */
  syncBlobsOnce(): Promise<number>;
  /** One full cycle: pull (see the other devices first), push, then blobs. */
  syncOnce(): Promise<{ pushed: number; pulled: number; blobs: number }>;
  /** Lazy download: fetch, decrypt, store locally, mark synced.
   *  "absent" = the relay has no such blob; errors throw. */
  fetchBlob(key: string): Promise<"fetched" | "absent">;
};

const maxStamp = (stamps: HlcStamp[]): HlcStamp | null => {
  let best: HlcStamp | null = null;
  for (const s of stamps) {
    if (
      !best ||
      s.wallMs > best.wallMs ||
      (s.wallMs === best.wallMs &&
        (s.counter > best.counter ||
          (s.counter === best.counter && s.deviceId > best.deviceId)))
    ) {
      best = s;
    }
  }
  return best;
};

export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  const { store, relay, observe } = options;
  const batchSize = options.batchSize ?? 200;
  const blobBatchSize = options.blobBatchSize ?? 8;
  const blobChunkBytes = options.blobChunkBytes ?? BLOB_CHUNK_BYTES;

  function requireKey(): Uint8Array {
    const key = options.masterKey();
    if (!key) throw new Error("sync: no master key — connect an account first");
    return key;
  }

  // Cycle-scoped counters; `syncOnce` zeroes them, each step patches and
  // emits a copy. Standalone pull/push calls report too — their consumer is
  // the same status snapshot.
  let progress: SyncCycleProgress = {
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
  function report(patch: Partial<SyncCycleProgress>): void {
    progress = { ...progress, ...patch };
    options.onProgress?.(progress);
  }

  async function pushOnce(): Promise<number> {
    const key = requireKey();
    let pushed = 0;
    for (;;) {
      const batch = await store.outboxEvents(batchSize);
      if (batch.length === 0) break;
      const sealedBatch = batch.map((event) => sealEvent(key, event));
      let seqs: Record<string, number>;
      try {
        seqs = await relay.pushEvents(sealedBatch);
      } catch (error) {
        await store.markEventsFailed(
          batch.map((e) => e.id),
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
      const assigned = batch
        .filter((e) => typeof seqs[e.id] === "number")
        .map((e): [string, number] => [e.id, seqs[e.id]]);
      await store.markEventsPushed(assigned);
      pushed += assigned.length;
      report({ phase: "push", pushed });
      if (batch.length < batchSize) break;
    }
    if (pushed > 0) await store.touch("push");
    return pushed;
  }

  async function pullOnce(): Promise<number> {
    const key = requireKey();
    // A previous session may have staged events it never finalized (crash,
    // killed process); heal before pulling more on top. No-op normally.
    await store.finalizeStaged();
    let after = await store.eventsCursor();
    let merged = 0;
    // Once a page falls behind the local HLC frontier, `applyRemote` rebuilds
    // the projections by full replay — and every later page of the same
    // backlog is behind the frontier too, so replaying per page would cost
    // O(pages × log). After the first replayed full page, switch to staging:
    // remaining pages enter the log untouched and ONE replay finishes the job.
    let staging = false;
    try {
      for (;;) {
        const page = await relay.pullEvents(after, batchSize);
        if (page.events.length > 0) {
          // Clock BEFORE content: once a stamp has been seen, no later local
          // stamp may sort under it — even if decrypting then fails.
          observe(page.events.map((e) => e.hlc));
          const plains = page.events.map((sealedEvent) => openEvent(key, sealedEvent));
          if (staging) {
            await store.stageRemote(plains);
          } else {
            const outcome = await store.applyRemote(plains);
            if (outcome.replayed && page.events.length === batchSize) staging = true;
          }
          await store.setEventsCursor(page.next, maxStamp(page.events.map((e) => e.hlc)));
          merged += page.events.length;
          report({ phase: "pull", pulled: merged });
        }
        after = page.next;
        if (page.events.length < batchSize) break;
      }
    } finally {
      // Also runs when a mid-backlog page throws: whatever made it into the
      // log must reach the projections before anyone reads them.
      if (staging) await store.finalizeStaged();
    }
    await store.touch("pull");
    return merged;
  }

  /** Upload one blob: whole (v1) at or under a chunk, sealed parts + commit
   *  (v2) above it. Part progress lands in the cycle counters as it moves. */
  async function uploadBlob(key: Uint8Array, blobKey: string, bytes: Uint8Array): Promise<void> {
    if (bytes.length <= blobChunkBytes) {
      await relay.putBlob(blobKey, sealBlob(key, blobKey, bytes));
      return;
    }
    const parts = Math.ceil(bytes.length / blobChunkBytes);
    report({ blobPartsDone: 0, blobPartsTotal: parts });
    for (let index = 0; index < parts; index += 1) {
      const chunk = bytes.subarray(index * blobChunkBytes, (index + 1) * blobChunkBytes);
      await relay.putBlobPart(blobKey, index, parts, sealBlobPart(key, blobKey, index, parts, chunk));
      report({ blobPartsDone: index + 1 });
    }
    await relay.commitBlob(blobKey, parts);
  }

  async function syncBlobsOnce(): Promise<number> {
    const key = requireKey();
    const tasks = await store.outboxBlobs(blobBatchSize);
    let uploaded = 0;
    report({ phase: "blobs", blobsDone: 0, blobsTotal: tasks.length });
    for (const task of tasks) {
      report({ blobKey: task.key, blobDirection: "up", blobPartsDone: 0, blobPartsTotal: 0 });
      try {
        const bytes = await store.readBlob(task.key);
        if (!bytes) {
          // Manifest-only or vanished bytes: nothing to push, ever.
          await store.markBlobsRejected([task.key], ERR_SYNC_NO_LOCAL_BYTES);
          continue;
        }
        await uploadBlob(key, task.key, bytes);
        await store.markBlobsPushed([task.key]);
        uploaded += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A permanent refusal (the relay's 4xx, a transport's coded
        // rejection: quota, malformed) — retrying re-uploads the whole file
        // into a guaranteed refusal every cycle. Only transient failures stay
        // queued. One stuck blob never dams the queue behind it.
        if (isPermanentBlobRefusal(error)) {
          log.warn("blob upload rejected", error);
          await store.markBlobsRejected([task.key], classifyBlobRejection(error));
        } else {
          await store.markBlobsFailed([task.key], message);
        }
      } finally {
        // Attempts, not successes: the bar reflects queue movement either way.
        report({
          blobsDone: progress.blobsDone + 1,
          blobKey: null,
          blobDirection: null,
          blobPartsDone: 0,
          blobPartsTotal: 0,
        });
      }
    }
    return uploaded;
  }

  async function fetchBlob(key: string): Promise<"fetched" | "absent"> {
    const masterKey = requireKey();
    const wire = await relay.getBlob(key);
    if (!wire) return "absent";
    const head = decodeBlobHead(wire);
    report({ phase: "blobs", blobKey: key, blobDirection: "down" });
    try {
      if (head.format === "v1") {
        await store.writeBlob(key, openBlob(masterKey, key, wire));
      } else {
        // Chunked: decrypted parts stream straight into the local store, so a
        // large book never assembles in engine memory.
        report({ blobPartsDone: 0, blobPartsTotal: head.partCount });
        const writer = await store.openBlobWriter(key);
        try {
          for (let index = 0; index < head.partCount; index += 1) {
            const partWire = await relay.getBlobPart(key, index);
            await writer.append(openBlobPart(masterKey, key, index, head.partCount, partWire));
            report({ blobPartsDone: index + 1 });
          }
          await writer.commit();
        } catch (error) {
          await writer.abort();
          throw error;
        }
      }
    } finally {
      report({ blobKey: null, blobDirection: null, blobPartsDone: 0, blobPartsTotal: 0 });
    }
    // The local write enqueued it for push; the relay already has it.
    await store.markBlobsPushed([key]);
    return "fetched";
  }

  return {
    pushOnce,
    pullOnce,
    syncBlobsOnce,
    fetchBlob,
    async syncOnce() {
      report({
        phase: "pull",
        pulled: 0,
        pushed: 0,
        blobsDone: 0,
        blobsTotal: 0,
        blobKey: null,
        blobDirection: null,
        blobPartsDone: 0,
        blobPartsTotal: 0,
      });
      const pulled = await pullOnce();
      const pushed = await pushOnce();
      const blobs = await syncBlobsOnce();
      return { pushed, pulled, blobs };
    },
  };
}

/**
 * Retry pacing for the scheduler: exponential from the base interval, capped.
 * Pure so the policy is testable without timers.
 */
export function nextSyncDelayMs(
  consecutiveFailures: number,
  { baseMs = 5 * 60_000, maxMs = 30 * 60_000 }: { baseMs?: number; maxMs?: number } = {},
): number {
  if (consecutiveFailures <= 0) return baseMs;
  return Math.min(baseMs * 2 ** consecutiveFailures, maxMs);
}
