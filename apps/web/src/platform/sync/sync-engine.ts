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
 *
 * Around that core, one cycle also (docs/sync-engine.md §13):
 *  - bootstraps an EMPTY device from the account's published checkpoint
 *    instead of replaying the whole mailbox, then backfills the pre-frontier
 *    log in bounded slices at the end of every cycle;
 *  - VERIFIES `unverified` bookkeeping (a re-login, an account switch, a
 *    bookkeeping migration) by asking the relay which ids / blobs it holds —
 *    never by re-uploading;
 *  - cuts local checkpoints on cadence, and publishes one when this device's
 *    log is mailbox-exact and the account's snapshot is stale.
 */
import {
  ERR_SYNC_CHECKPOINT_MISMATCH,
  ERR_SYNC_CHECKPOINT_PRECONDITION,
  ERR_SYNC_FILE_TOO_LARGE,
  ERR_SYNC_NO_LOCAL_BYTES,
  ERR_SYNC_QUOTA,
  ERR_SYNC_REJECTED,
  errorCode,
  type HlcStamp,
  type PublishSnapshotBody,
  type SnapshotMeta,
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

export type MergeReport = {
  appended: number;
  applied: number;
  replayed: boolean;
  /** A replay was needed but the log is still backfilling — deferred. */
  deferred?: boolean;
};

export type SyncOutboxCounts = {
  events: number;
  blobs: number;
  unverifiedEvents: number;
  unverifiedBlobs: number;
};

/** A projection checkpoint as the store registers it (storage/checkpoints.rs). */
export type CheckpointInfo = {
  id: number;
  blobKey: string;
  schemaVersion: number;
  hlc: HlcStamp;
  remoteSeq: number | null;
  eventCount: number;
  byteSize: number;
  origin: "local" | "publish" | "bootstrap";
  published: boolean;
  createdAt: string;
};

export type BackfillStatus = { frontierSeq: number; cursor: number; complete: boolean };
export type BackfillReport = {
  appended: number;
  cursor: number;
  complete: boolean;
  replayed: boolean;
};

/** Sealed-envelope overhead per object: version byte + 24-byte nonce + 16-byte tag. */
const SEAL_OVERHEAD = 41;
/** Ids per `/v1/events/have` request (the relay caps at 2,000). */
const HAVE_BATCH = 1_000;
/** Blobs verified (HEAD) per verify pass — each is one cheap request. */
const HEAD_BATCH = 64;
/** Pre-frontier pages backfilled per cycle; the scheduler reruns soon while
 *  any remain, so a large mailbox streams in without blocking the cycle. */
const BACKFILL_PAGES_PER_CYCLE = 5;
/** Publish a checkpoint once the account's is this many events behind. */
const PUBLISH_EVERY_EVENTS = 5_000;
/** ...or when none exists and the mailbox holds at least this many. */
const PUBLISH_MIN_EVENTS = 200;
/** Attempts are throttled per process: preconditions (unconfirmed events)
 *  can persist for a while and must not spam a cut per cycle. */
const PUBLISH_RETRY_MS = 30 * 60_000;

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

/**
 * The relay predates an endpoint: `/v1/events/have` and `/v1/snapshots`
 * answer 404 ("no such route"), blob HEAD answers 405. The engine then takes
 * the path it took before those endpoints existed (pessimistic verification,
 * no bootstrap, no publish) instead of failing the cycle — a client may ship
 * ahead of its relay, and a self-hosted relay may lag for a long time.
 */
function isUnsupportedByRelay(error: unknown, expected: 404 | 405): boolean {
  const status = (error as { status?: number }).status;
  return status === expected;
}

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
  /** `seqs[i]` is `events[i]`'s relay seq when the feed provides them: the
   *  store settles push bookkeeping from them (a pulled id is a held id). */
  applyRemote(events: PlainEvent[], seqs?: number[]): Promise<MergeReport>;
  /** Append pulled events to the log WITHOUT applying — the batched half of a
   *  large backlog merge; `finalizeStaged` replays once for all of them. */
  stageRemote(events: PlainEvent[], seqs?: number[]): Promise<number>;
  /** Replay everything staged (no-op when nothing is). Safe to call anytime. */
  finalizeStaged(): Promise<void>;
  outboxCounts(): Promise<SyncOutboxCounts>;
  // ── Verification (the `unverified` bookkeeping state) ──
  unverifiedEvents(limit: number): Promise<string[]>;
  resolveEvents(known: Array<[string, number]>, missing: string[]): Promise<void>;
  /** A backend that cannot answer by id: everything unverified owes a push. */
  assumeEventsMissing(): Promise<number>;
  unverifiedBlobs(limit: number): Promise<Array<{ key: string; byteSize: number | null }>>;
  resolveBlobs(present: string[], absent: string[]): Promise<void>;
  assumeBlobsMissing(): Promise<number>;
  // ── Checkpoints (storage/checkpoints.rs) ──
  schemaVersion(): Promise<number>;
  /** Cut a local checkpoint if enough happened since the last; prune old ones. */
  maintainCheckpoint(): Promise<CheckpointInfo | null>;
  /** Cut a mailbox-exact checkpoint to upload; throws a precondition code when
   *  the log is not exact right now. */
  preparePublishCheckpoint(): Promise<CheckpointInfo>;
  markCheckpointPublished(id: number): Promise<void>;
  /** Adopt a downloaded `snapshot:` blob as this (empty) device's projections. */
  restoreBootstrapCheckpoint(blobKey: string): Promise<CheckpointInfo>;
  backfillStatus(): Promise<BackfillStatus | null>;
  backfillEvents(events: PlainEvent[], seqs: number[]): Promise<BackfillReport>;
  /** Re-evaluate completeness from the cursors (the pull ran past the frontier). */
  settleBackfill(): Promise<BackfillStatus | null>;
  deviceId(): Promise<string>;
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
  /** `seqs` (parallel to `events`) when the backend numbers events — the
   *  first-party relay does; a plugin transport's journal positions are not
   *  mailbox seqs and stay absent. */
  pullEvents(
    after: number,
    limit: number,
  ): Promise<{ events: SealedEvent[]; next: number; seqs?: number[] }>;
  putBlob(key: string, bytes: Uint8Array): Promise<void>;
  getBlob(key: string): Promise<Uint8Array | null>;
  /** Chunked transport (sync-envelope v2) for blobs over one request's worth. */
  putBlobPart(key: string, index: number, parts: number, bytes: Uint8Array): Promise<void>;
  commitBlob(key: string, parts: number): Promise<void>;
  getBlobPart(key: string, index: number): Promise<Uint8Array>;
  // ── Optional: verification and checkpoints. A backend without them gets
  //    the pessimistic path (unverified → pending; no bootstrap/publish). ──
  /** Which of `ids` the mailbox holds, with their seqs. */
  haveEvents?(ids: string[]): Promise<Record<string, number>>;
  /** Sealed bytes + part count held for `key`; null when absent. */
  headBlob?(key: string): Promise<{ bytes: number; parts: number } | null>;
  latestSnapshot?(schemaVersion: number): Promise<SnapshotMeta | null>;
  publishSnapshot?(meta: PublishSnapshotBody): Promise<"published" | "conflict">;
  deleteBlob?(key: string): Promise<void>;
};

/**
 * Live counters for the cycle in flight — what the sync indicator and the
 * Data & Sync panel narrate. Counts are cumulative within one `syncOnce`;
 * `blobsTotal` is this PASS's queue (at most `blobBatchSize`), not the whole
 * backlog — the backlog is a store question (`sync_outbox_counts`).
 */
export type SyncCycleProgress = {
  phase: "bootstrap" | "pull" | "verify" | "push" | "blobs" | "backfill" | "checkpoint";
  pulled: number;
  pushed: number;
  /** Bookkeeping rows settled by the verify phase this cycle. */
  verified: number;
  /** Pre-frontier events backfilled this cycle, and the finish line. */
  backfilled: number;
  backfillFrontier: number;
  backfillCursor: number;
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
  /** When to publish a checkpoint (tests shrink these; see the constants). */
  checkpointPublish?: { minEvents?: number; everyEvents?: number; retryMs?: number };
};

export type SyncCycleOutcome = {
  pushed: number;
  pulled: number;
  blobs: number;
  verified: number;
  backfilled: number;
  /** Pre-frontier events still to backfill (0 = the log is complete). */
  backfillRemaining: number;
  bootstrapped: boolean;
};

export type SyncEngine = {
  /** Drain the event outbox. Returns how many events the relay accepted. */
  pushOnce(): Promise<number>;
  /** Pull and merge everything after the cursor. Returns events merged. */
  pullOnce(): Promise<number>;
  /** Settle `unverified` bookkeeping against the relay. Returns rows settled. */
  verifyOnce(): Promise<number>;
  /** Upload pending blobs. Returns how many landed; failures are marked, not thrown. */
  syncBlobsOnce(): Promise<number>;
  /** Restore the account's published checkpoint onto a device whose cursor
   *  is at zero and whose log holds nothing but unconfirmed local writes;
   *  "skipped" when there is nothing to restore from, the device has
   *  confirmed history, or the backend has no snapshots. */
  bootstrapOnce(): Promise<"restored" | "skipped">;
  /** Backfill up to `maxPages` pre-frontier pages. Returns events appended. */
  backfillOnce(maxPages?: number): Promise<{ appended: number; remaining: number }>;
  /** Cut/prune local checkpoints; publish one when the account's is stale
   *  (skipped, unthrottled, in a cycle that pushed — the cursor lags). */
  checkpointOnce(options?: { pushedThisCycle?: number }): Promise<{ cut: boolean; published: boolean }>;
  /** One full cycle: verify → bootstrap (if fresh) → pull → push → blobs →
   *  backfill slice → checkpoints. */
  syncOnce(): Promise<SyncCycleOutcome>;
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
  const publishMinEvents = options.checkpointPublish?.minEvents ?? PUBLISH_MIN_EVENTS;
  const publishEveryEvents = options.checkpointPublish?.everyEvents ?? PUBLISH_EVERY_EVENTS;
  const publishRetryMs = options.checkpointPublish?.retryMs ?? PUBLISH_RETRY_MS;

  function requireKey(): Uint8Array {
    const key = options.masterKey();
    if (!key) throw new Error("sync: no master key — connect an account first");
    return key;
  }

  // Cycle-scoped counters; `syncOnce` zeroes them, each step patches and
  // emits a copy. Standalone pull/push calls report too — their consumer is
  // the same status snapshot.
  const freshProgress = (): SyncCycleProgress => ({
    phase: "verify",
    pulled: 0,
    pushed: 0,
    verified: 0,
    backfilled: 0,
    backfillFrontier: 0,
    backfillCursor: 0,
    blobsDone: 0,
    blobsTotal: 0,
    blobKey: null,
    blobDirection: null,
    blobPartsDone: 0,
    blobPartsTotal: 0,
  });
  let progress: SyncCycleProgress = freshProgress();
  function report(patch: Partial<SyncCycleProgress>): void {
    progress = { ...progress, ...patch };
    options.onProgress?.(progress);
  }
  let lastPublishAttemptAt = 0;

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
          // A pulled id is a held id: the seqs settle push bookkeeping too.
          const seqs = page.seqs && page.seqs.length === page.events.length ? page.seqs : undefined;
          if (staging) {
            await store.stageRemote(plains, seqs);
          } else {
            const outcome = await store.applyRemote(plains, seqs);
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

  // ── Verification ──────────────────────────────────────────────────────────

  /** What `byteSize` plaintext bytes seal to, in the format upload would pick. */
  function expectedSeal(byteSize: number): { bytes: number; parts: number } {
    if (byteSize <= blobChunkBytes) return { bytes: byteSize + SEAL_OVERHEAD, parts: 0 };
    const parts = Math.ceil(byteSize / blobChunkBytes);
    return { bytes: byteSize + SEAL_OVERHEAD * parts, parts };
  }

  async function verifyOnce(): Promise<number> {
    requireKey();
    let settled = 0;
    report({ phase: "verify", verified: 0 });
    // Events: ask by id, in batches. Without the endpoint, the pessimistic
    // answer (everything owes a push) is the old behaviour, made explicit.
    if (!relay.haveEvents) {
      settled += await store.assumeEventsMissing();
    } else {
      for (;;) {
        const ids = await store.unverifiedEvents(HAVE_BATCH);
        if (ids.length === 0) break;
        let held: Record<string, number>;
        try {
          held = await relay.haveEvents(ids);
        } catch (error) {
          if (!isUnsupportedByRelay(error, 404)) throw error;
          log.warn("relay has no /v1/events/have; unverified events will be pushed");
          settled += await store.assumeEventsMissing();
          break;
        }
        const known: Array<[string, number]> = [];
        const missing: string[] = [];
        for (const id of ids) {
          const seq = held[id];
          if (typeof seq === "number") known.push([id, seq]);
          else missing.push(id);
        }
        await store.resolveEvents(known, missing);
        settled += ids.length;
        report({ verified: settled });
        if (ids.length < HAVE_BATCH) break;
      }
    }
    // Blobs: HEAD each; "present" means the relay holds exactly what these
    // bytes would seal to, so a half-staged or differently-sized object is
    // re-uploaded rather than trusted.
    if (!relay.headBlob) {
      settled += await store.assumeBlobsMissing();
    } else {
      for (;;) {
        const tasks = await store.unverifiedBlobs(HEAD_BATCH);
        if (tasks.length === 0) break;
        const present: string[] = [];
        const absent: string[] = [];
        let unsupported = false;
        for (const task of tasks) {
          let head: { bytes: number; parts: number } | null;
          try {
            head = await relay.headBlob(task.key);
          } catch (error) {
            if (!isUnsupportedByRelay(error, 405)) throw error;
            unsupported = true;
            break;
          }
          if (!head) {
            absent.push(task.key);
            continue;
          }
          if (task.byteSize === null) {
            present.push(task.key);
            continue;
          }
          const expected = expectedSeal(task.byteSize);
          if (head.parts === expected.parts && head.bytes === expected.bytes) present.push(task.key);
          else absent.push(task.key);
        }
        if (unsupported) {
          log.warn("relay has no blob HEAD; unverified blobs will be uploaded");
          settled += await store.assumeBlobsMissing();
          break;
        }
        await store.resolveBlobs(present, absent);
        settled += tasks.length;
        report({ verified: settled });
        if (tasks.length < HEAD_BATCH) break;
      }
    }
    return settled;
  }

  // ── Bootstrap, backfill, checkpoints ──────────────────────────────────────

  async function bootstrapOnce(): Promise<"restored" | "skipped"> {
    if (!relay.latestSnapshot) return "skipped";
    const key = requireKey();
    if ((await store.eventsCursor()) !== 0) return "skipped";
    const schema = await store.schemaVersion();
    let snapshot: SnapshotMeta | null;
    try {
      snapshot = await relay.latestSnapshot(schema);
    } catch (error) {
      if (!isUnsupportedByRelay(error, 404)) throw error;
      return "skipped";
    }
    if (!snapshot) return "skipped";
    report({ phase: "bootstrap" });
    // Download through the ordinary sealed path: the bytes land in the local
    // blob store under the snapshot key, then the store adopts them.
    const fetched = await fetchBlobWith(key, snapshot.blobKey);
    if (fetched === "absent") {
      log.warn(`published snapshot ${snapshot.blobKey} is missing on the relay; replaying instead`);
      return "skipped";
    }
    try {
      const info = await store.restoreBootstrapCheckpoint(snapshot.blobKey);
      // The projections now reflect stamps up to the frontier: the clock must
      // sort every local write after it.
      observe([info.hlc]);
      log.info(
        `bootstrapped from checkpoint ${info.blobKey} (frontier seq ${info.remoteSeq}, ${info.eventCount} events)`,
      );
      return "restored";
    } catch (error) {
      const code = errorCode(error);
      if (code === ERR_SYNC_CHECKPOINT_PRECONDITION || code === ERR_SYNC_CHECKPOINT_MISMATCH) {
        // Confirmed local history exists, or the snapshot is from another
        // build: the full replay is the honest path and always available.
        log.warn(`snapshot ${snapshot.blobKey} not adopted (${code}); replaying the mailbox`);
        return "skipped";
      }
      throw error;
    }
  }

  async function backfillOnce(maxPages = BACKFILL_PAGES_PER_CYCLE): Promise<{ appended: number; remaining: number }> {
    let status = await store.backfillStatus();
    if (!status) return { appended: 0, remaining: 0 };
    const key = requireKey();
    let appended = 0;
    report({
      phase: "backfill",
      backfilled: 0,
      backfillFrontier: status.frontierSeq,
      backfillCursor: status.cursor,
    });
    for (let page = 0; page < maxPages && !status.complete; page += 1) {
      const pulled = await relay.pullEvents(status.cursor, batchSize);
      const seqs = pulled.seqs;
      if (!seqs || seqs.length !== pulled.events.length) {
        // A feed without seqs cannot say where the frontier falls; the
        // backfill waits for a relay that numbers events.
        log.warn("backfill needs per-event seqs; the feed provides none");
        break;
      }
      const events: PlainEvent[] = [];
      const kept: number[] = [];
      for (let i = 0; i < pulled.events.length; i += 1) {
        if (seqs[i] > status.frontierSeq) break;
        events.push(openEvent(key, pulled.events[i]));
        kept.push(seqs[i]);
      }
      if (events.length === 0) {
        // Past the frontier (or an empty mailbox): let the store settle.
        status = (await store.settleBackfill()) ?? { ...status, complete: true };
        break;
      }
      observe(events.map((e) => e.hlc));
      const outcome = await store.backfillEvents(events, kept);
      appended += outcome.appended;
      status = { frontierSeq: status.frontierSeq, cursor: outcome.cursor, complete: outcome.complete };
      report({ backfilled: appended, backfillCursor: outcome.cursor });
      if (outcome.replayed) log.info("backfill complete; deferred replay applied");
      if (pulled.events.length < batchSize) {
        status = (await store.settleBackfill()) ?? { ...status, complete: true };
        break;
      }
    }
    const remaining = status.complete ? 0 : Math.max(0, status.frontierSeq - status.cursor);
    return { appended, remaining };
  }

  async function checkpointOnce(options: { pushedThisCycle?: number } = {}): Promise<{ cut: boolean; published: boolean }> {
    report({ phase: "checkpoint" });
    const cut = (await store.maintainCheckpoint()) !== null;
    let published = false;
    // A push this cycle assigned seqs past the cursor, so the log is not
    // mailbox-exact until the next pull hands them back — the relay's
    // doorbell rings for our own append, and that cycle publishes. Not an
    // attempt, so it is not throttled.
    const pushedThisCycle = options.pushedThisCycle ?? 0;
    if (
      pushedThisCycle === 0 &&
      relay.latestSnapshot &&
      relay.publishSnapshot &&
      Date.now() - lastPublishAttemptAt >= publishRetryMs
    ) {
      published = await publishIfDue();
    }
    return { cut, published };
  }

  /**
   * Publish when the account has no checkpoint for this schema (and the
   * mailbox is worth one), or when the published one is PUBLISH_EVERY_EVENTS
   * behind our cursor. The store enforces the real precondition — the log is
   * mailbox-exact — by refusing to cut otherwise.
   */
  async function publishIfDue(): Promise<boolean> {
    const key = requireKey();
    if (!relay.latestSnapshot || !relay.publishSnapshot) return false;
    const counts = await store.outboxCounts();
    if (counts.events > 0 || counts.unverifiedEvents > 0) return false;
    if ((await store.backfillStatus()) !== null) return false;
    const cursor = await store.eventsCursor();
    const schema = await store.schemaVersion();
    let existing: SnapshotMeta | null;
    try {
      existing = await relay.latestSnapshot(schema);
    } catch (error) {
      if (!isUnsupportedByRelay(error, 404)) throw error;
      lastPublishAttemptAt = Date.now();
      return false;
    }
    const due = existing
      ? cursor - existing.frontierSeq >= publishEveryEvents
      : cursor >= publishMinEvents;
    if (!due) return false;
    let info: CheckpointInfo;
    try {
      info = await store.preparePublishCheckpoint();
    } catch (error) {
      if (errorCode(error) === ERR_SYNC_CHECKPOINT_PRECONDITION) {
        // Cheap checks only, nothing was cut: try again next cycle.
        log.info("checkpoint publish skipped: the log is not mailbox-exact right now");
        return false;
      }
      throw error;
    }
    // A file was cut and is about to be uploaded: this is the attempt the
    // throttle paces.
    lastPublishAttemptAt = Date.now();
    if (info.remoteSeq === null) return false;
    const bytes = await store.readBlob(info.blobKey);
    if (!bytes) {
      log.warn(`checkpoint ${info.blobKey} has no local bytes; not published`);
      return false;
    }
    await uploadBlob(key, info.blobKey, bytes);
    const outcome = await relay.publishSnapshot({
      blobKey: info.blobKey,
      frontierSeq: info.remoteSeq,
      schemaVersion: info.schemaVersion,
      byteSize: info.byteSize,
      deviceId: await store.deviceId(),
    });
    if (outcome === "conflict") {
      // Someone published something at least as fresh meanwhile: our upload
      // is redundant on the shelf (the local file stays a replay base).
      await relay.deleteBlob?.(info.blobKey);
      log.info(`checkpoint ${info.blobKey} not published: a fresher one exists`);
      return false;
    }
    await store.markCheckpointPublished(info.id);
    log.info(`published checkpoint ${info.blobKey} at seq ${info.remoteSeq}`);
    return true;
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
    return fetchBlobWith(requireKey(), key);
  }

  async function fetchBlobWith(masterKey: Uint8Array, key: string): Promise<"fetched" | "absent"> {
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
    verifyOnce,
    syncBlobsOnce,
    bootstrapOnce,
    backfillOnce,
    checkpointOnce,
    fetchBlob,
    async syncOnce() {
      progress = freshProgress();
      report({});
      // Verify first: an account adoption leaves every local row
      // `unverified`, and only rows the relay has disowned (now `pending`)
      // may sit on top of a restored checkpoint.
      const verified = await verifyOnce();
      const bootstrapped = (await bootstrapOnce()) === "restored";
      const pulled = await pullOnce();
      const pushed = await pushOnce();
      const blobs = await syncBlobsOnce();
      const backfill = await backfillOnce();
      await checkpointOnce({ pushedThisCycle: pushed });
      return {
        pushed,
        pulled,
        blobs,
        verified,
        backfilled: backfill.appended,
        backfillRemaining: backfill.remaining,
        bootstrapped,
      };
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
