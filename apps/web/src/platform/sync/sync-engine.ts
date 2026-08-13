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
 * events land behind the frontier) → advance the cursor. Push and pull never
 * conflict-resolve anything: projections are a pure function of the log.
 */
import type { HlcStamp } from "@read-aware/core";
import {
  openBlob,
  openEvent,
  sealBlob,
  sealEvent,
  type PlainEvent,
  type SealedEvent,
} from "../sync-envelope";

export type MergeReport = { appended: number; applied: number; replayed: boolean };

/** The local (SQLite-over-IPC) side the engine drives. */
export type SyncLocalStore = {
  outboxEvents(limit: number): Promise<PlainEvent[]>;
  markEventsPushed(assigned: Array<[string, number]>): Promise<void>;
  markEventsFailed(ids: string[], error: string): Promise<void>;
  applyRemote(events: PlainEvent[]): Promise<MergeReport>;
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
  touch(kind: "push" | "pull"): Promise<void>;
};

/** The remote side — the relay's mailbox and shelf. */
export type SyncRelayApi = {
  pushEvents(events: SealedEvent[]): Promise<Record<string, number>>;
  pullEvents(after: number, limit: number): Promise<{ events: SealedEvent[]; next: number }>;
  putBlob(key: string, bytes: Uint8Array): Promise<void>;
  getBlob(key: string): Promise<Uint8Array | null>;
};

export type SyncEngineOptions = {
  store: SyncLocalStore;
  relay: SyncRelayApi;
  /** The E2E master key; null = not connected, every operation refuses. */
  masterKey: () => Uint8Array | null;
  /** The HLC receive rule (platform/domain-events.observeRemoteHlcStamps). */
  observe: (stamps: HlcStamp[]) => void;
  /** Events per push batch / pull page. */
  batchSize?: number;
  /** Blobs attempted per blob pass. */
  blobBatchSize?: number;
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
  /** Lazy download: fetch, decrypt, store locally, mark synced. Null = relay has no such blob. */
  fetchBlob(key: string): Promise<Uint8Array | null>;
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

  function requireKey(): Uint8Array {
    const key = options.masterKey();
    if (!key) throw new Error("sync: no master key — connect an account first");
    return key;
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
      if (batch.length < batchSize) break;
    }
    if (pushed > 0) await store.touch("push");
    return pushed;
  }

  async function pullOnce(): Promise<number> {
    const key = requireKey();
    let after = await store.eventsCursor();
    let merged = 0;
    for (;;) {
      const page = await relay.pullEvents(after, batchSize);
      if (page.events.length > 0) {
        // Clock BEFORE content: once a stamp has been seen, no later local
        // stamp may sort under it — even if decrypting then fails.
        observe(page.events.map((e) => e.hlc));
        const plains = page.events.map((sealedEvent) => openEvent(key, sealedEvent));
        await store.applyRemote(plains);
        await store.setEventsCursor(page.next, maxStamp(page.events.map((e) => e.hlc)));
        merged += page.events.length;
      }
      after = page.next;
      if (page.events.length < batchSize) break;
    }
    await store.touch("pull");
    return merged;
  }

  async function syncBlobsOnce(): Promise<number> {
    const key = requireKey();
    const tasks = await store.outboxBlobs(blobBatchSize);
    let uploaded = 0;
    for (const task of tasks) {
      try {
        const bytes = await store.readBlob(task.key);
        if (!bytes) {
          // Manifest-only or vanished bytes: nothing to push, ever.
          await store.markBlobsRejected([task.key], "no local bytes to upload");
          continue;
        }
        await relay.putBlob(task.key, sealBlob(key, task.key, bytes));
        await store.markBlobsPushed([task.key]);
        uploaded += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A 4xx is the relay's final word (size cap, quota) — retrying re-uploads
        // the whole file into a guaranteed refusal every cycle. Only transient
        // failures stay queued. One stuck blob never dams the queue behind it.
        const status = (error as { status?: number }).status;
        if (typeof status === "number" && status >= 400 && status < 500) {
          await store.markBlobsRejected([task.key], message);
        } else {
          await store.markBlobsFailed([task.key], message);
        }
      }
    }
    return uploaded;
  }

  async function fetchBlob(key: string): Promise<Uint8Array | null> {
    const masterKey = requireKey();
    const wire = await relay.getBlob(key);
    if (!wire) return null;
    const bytes = openBlob(masterKey, key, wire);
    await store.writeBlob(key, bytes);
    // The local write enqueued it for push; the relay already has it.
    await store.markBlobsPushed([key]);
    return bytes;
  }

  return {
    pushOnce,
    pullOnce,
    syncBlobsOnce,
    fetchBlob,
    async syncOnce() {
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
