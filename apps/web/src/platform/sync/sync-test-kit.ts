/**
 * Shared fixtures for the sync suites (`sync-engine.test.ts`,
 * `transport-feed.test.ts`): a fake device (local store + recording), a fake
 * relay (numbered mailbox + blob shelf), and the tiny KDF/test key. Extracted
 * so the plugin-transport suite exercises the REAL engine against the REAL
 * feed adapter with the same two-device harness the relay path is proven on.
 */
import {
  AppError,
  ERR_SYNC_CHECKPOINT_PRECONDITION,
  type HlcStamp,
  type SnapshotMeta,
} from "@read-aware/core";
import { deriveMasterKey, sealEvent, type PlainEvent } from "../sync-envelope";
import {
  createSyncEngine,
  type BackfillStatus,
  type CheckpointInfo,
  type MergeReport,
  type SyncLocalStore,
  type SyncRelayApi,
} from "./sync-engine";

/** The fake device's checkpoint file: its applied events, as JSON. */
type FakeSnapshotFile = { frontierSeq: number; hlc: HlcStamp; events: PlainEvent[] };

export const TEST_KDF = { algo: "argon2id", t: 1, m: 16, p: 1 } as const;
export const testMasterKey = deriveMasterKey(
  "同一个口令",
  "c2FsdHNhbHRzYWx0c2FsdA==",
  TEST_KDF,
);

export function plain(
  id: string,
  wallMs: number,
  deviceId: string,
  text: string,
): PlainEvent {
  return {
    id,
    type: "highlight.created",
    hlc: { wallMs, counter: 0, deviceId },
    payload: { highlightId: id, bookId: "b1", text },
  };
}

/** A fake device: outbox + applied log + blob shelf, with recording. */
export function fakeDevice() {
  const outbox: PlainEvent[] = [];
  const failed = new Map<string, string>();
  const applied: PlainEvent[] = [];
  const observed: HlcStamp[] = [];
  const blobs = new Map<string, Uint8Array>();
  const blobOutbox = new Set<string>();
  const blobStates = new Map<string, string>();
  let cursor = 0;
  const knownIds = new Set<string>();
  const staged: PlainEvent[] = [];
  // Bookkeeping the engine's verify phase settles: ids/keys whose mailbox
  // status is unknown, and the seq the relay confirmed per event.
  const unverified = new Set<string>();
  const unverifiedBlobs = new Map<string, number | null>();
  const remoteIds = new Map<string, number>();
  // Checkpoints, reduced to what the engine observes: a registry of cut
  // checkpoints (files are JSON blobs on the shelf) and the backfill window.
  const checkpoints: CheckpointInfo[] = [];
  let backfill: BackfillStatus | null = null;
  const settleSeqs = (events: PlainEvent[], seqs?: number[]) => {
    if (!seqs) return;
    events.forEach((event, i) => {
      remoteIds.set(event.id, seqs[i]);
      unverified.delete(event.id);
      const at = outbox.findIndex((e) => e.id === event.id);
      if (at >= 0) outbox.splice(at, 1);
    });
  };
  const frontierOf = (events: PlainEvent[]): HlcStamp =>
    events.reduce<HlcStamp>(
      (best, e) => (e.hlc.wallMs > best.wallMs ? e.hlc : best),
      { wallMs: 0, counter: 0, deviceId: "none" },
    );
  // Test control: make applyRemote report the replay fallback (events behind
  // the local frontier), which is what flips the pull loop into staging.
  const controls = {
    replayOnApply: false,
    applyCalls: 0,
    stageCalls: 0,
    finalizeCalls: 0,
    schemaVersion: 1,
    deviceId: "device-fake",
    checkpointDue: false,
  };

  const store: SyncLocalStore = {
    async outboxEvents(limit) {
      return outbox.slice(0, limit);
    },
    async markEventsPushed(assigned) {
      for (const [id] of assigned) {
        const at = outbox.findIndex((e) => e.id === id);
        if (at >= 0) outbox.splice(at, 1);
        failed.delete(id);
      }
    },
    async markEventsFailed(ids, error) {
      for (const id of ids) failed.set(id, error);
    },
    async applyRemote(events, seqs): Promise<MergeReport> {
      controls.applyCalls += 1;
      let appended = 0;
      for (const event of events) {
        if (knownIds.has(event.id)) continue;
        knownIds.add(event.id);
        applied.push(event);
        appended += 1;
      }
      settleSeqs(events, seqs);
      return { appended, applied: appended, replayed: controls.replayOnApply };
    },
    async stageRemote(events, seqs) {
      controls.stageCalls += 1;
      let appended = 0;
      for (const event of events) {
        if (knownIds.has(event.id)) continue;
        knownIds.add(event.id);
        staged.push(event);
        appended += 1;
      }
      settleSeqs(events, seqs);
      return appended;
    },
    async outboxCounts() {
      return {
        events: outbox.length,
        blobs: blobOutbox.size,
        unverifiedEvents: unverified.size,
        unverifiedBlobs: unverifiedBlobs.size,
      };
    },
    async unverifiedEvents(limit) {
      return [...unverified].slice(0, limit);
    },
    async resolveEvents(known, missing) {
      for (const [id, seq] of known) {
        unverified.delete(id);
        remoteIds.set(id, seq);
      }
      for (const id of missing) {
        unverified.delete(id);
        const event = applied.find((e) => e.id === id);
        if (event && !outbox.some((e) => e.id === id)) outbox.push(event);
      }
    },
    async assumeEventsMissing() {
      const ids = [...unverified];
      await store.resolveEvents([], ids);
      return ids.length;
    },
    async unverifiedBlobs(limit) {
      return [...unverifiedBlobs].slice(0, limit).map(([key, byteSize]) => ({ key, byteSize }));
    },
    async resolveBlobs(present, absent) {
      for (const k of present) {
        unverifiedBlobs.delete(k);
        blobStates.set(k, "synced");
      }
      for (const k of absent) {
        unverifiedBlobs.delete(k);
        blobOutbox.add(k);
      }
    },
    async assumeBlobsMissing() {
      const keys = [...unverifiedBlobs.keys()];
      await store.resolveBlobs([], keys);
      return keys.length;
    },
    async schemaVersion() {
      return controls.schemaVersion;
    },
    async maintainCheckpoint() {
      if (!controls.checkpointDue) return null;
      controls.checkpointDue = false;
      const info: CheckpointInfo = {
        id: checkpoints.length + 1,
        blobKey: `snapshot:v${controls.schemaVersion}:${controls.deviceId}:local-${checkpoints.length + 1}`,
        schemaVersion: controls.schemaVersion,
        hlc: frontierOf(applied),
        remoteSeq: cursor,
        eventCount: applied.length,
        byteSize: 0,
        origin: "local",
        published: false,
        createdAt: new Date(0).toISOString(),
      };
      checkpoints.push(info);
      return info;
    },
    async preparePublishCheckpoint() {
      if (outbox.length > 0 || unverified.size > 0 || backfill !== null) {
        throw new AppError(ERR_SYNC_CHECKPOINT_PRECONDITION, "not mailbox-exact");
      }
      const file: FakeSnapshotFile = { frontierSeq: cursor, hlc: frontierOf(applied), events: [...applied] };
      const bytes = new TextEncoder().encode(JSON.stringify(file));
      const blobKey = `snapshot:v${controls.schemaVersion}:${controls.deviceId}:${cursor}`;
      blobs.set(blobKey, bytes);
      const info: CheckpointInfo = {
        id: checkpoints.length + 1,
        blobKey,
        schemaVersion: controls.schemaVersion,
        hlc: file.hlc,
        remoteSeq: cursor,
        eventCount: applied.length,
        byteSize: bytes.length,
        origin: "publish",
        published: false,
        createdAt: new Date(0).toISOString(),
      };
      checkpoints.push(info);
      return info;
    },
    async markCheckpointPublished(id) {
      const info = checkpoints.find((c) => c.id === id);
      if (info) info.published = true;
    },
    async restoreBootstrapCheckpoint(blobKey) {
      // Only unconfirmed local history may sit on top of a restore.
      const unconfirmed = new Set(outbox.map((e) => e.id));
      if ([...knownIds].some((id) => !unconfirmed.has(id))) {
        throw new AppError(ERR_SYNC_CHECKPOINT_PRECONDITION, "confirmed history");
      }
      const bytes = blobs.get(blobKey);
      if (!bytes) throw new Error(`no local bytes for ${blobKey}`);
      const file = JSON.parse(new TextDecoder().decode(bytes)) as FakeSnapshotFile;
      const local = applied.splice(0, applied.length);
      applied.push(...file.events, ...local);
      cursor = file.frontierSeq;
      backfill = { frontierSeq: file.frontierSeq, cursor: 0, complete: false };
      const info: CheckpointInfo = {
        id: checkpoints.length + 1,
        blobKey,
        schemaVersion: controls.schemaVersion,
        hlc: file.hlc,
        remoteSeq: file.frontierSeq,
        eventCount: file.events.length,
        byteSize: bytes.length,
        origin: "bootstrap",
        published: true,
        createdAt: new Date(0).toISOString(),
      };
      checkpoints.push(info);
      return info;
    },
    async backfillStatus() {
      return backfill && !backfill.complete ? { ...backfill } : null;
    },
    async backfillEvents(events, seqs) {
      if (!backfill) throw new AppError(ERR_SYNC_CHECKPOINT_PRECONDITION, "no backfill open");
      let appended = 0;
      events.forEach((event, i) => {
        if (!knownIds.has(event.id)) {
          knownIds.add(event.id);
          appended += 1;
        }
        remoteIds.set(event.id, seqs[i]);
        backfill!.cursor = Math.max(backfill!.cursor, seqs[i]);
      });
      backfill.complete = backfill.cursor >= backfill.frontierSeq;
      return { appended, cursor: backfill.cursor, complete: backfill.complete, replayed: false };
    },
    async settleBackfill() {
      if (!backfill) return null;
      backfill.complete = backfill.cursor >= backfill.frontierSeq;
      return { ...backfill };
    },
    async deviceId() {
      return controls.deviceId;
    },
    async finalizeStaged() {
      controls.finalizeCalls += 1;
      if (staged.length > 0) {
        applied.push(...staged);
        staged.length = 0;
      }
    },
    async eventsCursor() {
      return cursor;
    },
    async setEventsCursor(next) {
      cursor = next;
    },
    async outboxBlobs(limit) {
      return [...blobOutbox].slice(0, limit).map((key) => ({ key }));
    },
    async markBlobsPushed(keys) {
      for (const k of keys) {
        blobOutbox.delete(k);
        blobStates.set(k, "synced");
      }
    },
    async markBlobsFailed(keys, error) {
      for (const k of keys) {
        blobStates.set(k, `failed: ${error}`);
      }
    },
    async markBlobsRejected(keys, error) {
      for (const k of keys) {
        blobOutbox.delete(k);
        blobStates.set(k, `rejected: ${error}`);
      }
    },
    async readBlob(k) {
      return blobs.get(k) ?? null;
    },
    async writeBlob(k, bytes) {
      blobs.set(k, bytes);
      blobOutbox.add(k); // a local write enqueues, exactly like put_blob
    },
    async openBlobWriter(k) {
      // Mirrors the native staged-write session: chunks accumulate, commit
      // lands through the same enqueue as writeBlob, abort drops the buffer.
      const chunks: Uint8Array[] = [];
      return {
        async append(bytes: Uint8Array) {
          chunks.push(bytes);
        },
        async commit() {
          const total = chunks.reduce((sum, c) => sum + c.length, 0);
          const joined = new Uint8Array(total);
          let offset = 0;
          for (const c of chunks) {
            joined.set(c, offset);
            offset += c.length;
          }
          blobs.set(k, joined);
          blobOutbox.add(k);
        },
        async abort() {
          chunks.length = 0;
        },
      };
    },
    async touch() {},
  };

  return {
    store,
    outbox,
    failed,
    applied,
    observed,
    blobs,
    blobOutbox,
    blobStates,
    commitLocal(event: PlainEvent) {
      knownIds.add(event.id);
      applied.push(event);
      outbox.push(event);
    },
    /** Simulate an account adoption: every event and blob becomes unverified. */
    adoptOtherAccount() {
      for (const event of applied) unverified.add(event.id);
      outbox.length = 0;
      for (const [k, bytes] of blobs) {
        if (!k.startsWith("snapshot:")) unverifiedBlobs.set(k, bytes.length);
      }
      blobOutbox.clear();
      cursor = 0;
    },
    unverified,
    unverifiedBlobs,
    remoteIds,
    checkpoints,
    backfillState: () => backfill,
    knownIds,
    putLocalBlob(key: string, bytes: Uint8Array) {
      blobs.set(key, bytes);
      blobOutbox.add(key);
    },
    cursorValue: () => cursor,
    staged,
    controls,
  };
}

/** The relay reduced to its essence: a numbered mailbox + a blob shelf. */
export function fakeRelay(): SyncRelayApi & {
  count(): number;
  failNextPush?: boolean;
  shelf: Map<string, Uint8Array>;
  snapshots: Map<number, SnapshotMeta>;
  calls: { have: number; head: number; pull: number };
} {
  const rows: Array<{ seq: number; sealed: ReturnType<typeof sealEvent> }> = [];
  const byId = new Map<string, number>();
  const shelf = new Map<string, Uint8Array>();
  const snapshots = new Map<number, SnapshotMeta>();
  const calls = { have: 0, head: 0, pull: 0 };
  const api = {
    failNextPush: false,
    shelf,
    snapshots,
    calls,
    count: () => rows.length,
    async pushEvents(events: ReturnType<typeof sealEvent>[]) {
      if (api.failNextPush) {
        api.failNextPush = false;
        throw new Error("relay 503");
      }
      const seqs: Record<string, number> = {};
      for (const sealed of events) {
        let seq = byId.get(sealed.id);
        if (seq === undefined) {
          seq = rows.length + 1;
          rows.push({ seq, sealed });
          byId.set(sealed.id, seq);
        }
        seqs[sealed.id] = seq;
      }
      return seqs;
    },
    async pullEvents(after: number, limit: number) {
      calls.pull += 1;
      const page = rows.filter((r) => r.seq > after).slice(0, limit);
      return {
        events: page.map((r) => r.sealed),
        seqs: page.map((r) => r.seq),
        next: page.length ? page[page.length - 1].seq : after,
      };
    },
    async haveEvents(ids: string[]) {
      calls.have += 1;
      const seqs: Record<string, number> = {};
      for (const id of ids) {
        const seq = byId.get(id);
        if (seq !== undefined) seqs[id] = seq;
      }
      return seqs;
    },
    async headBlob(key: string) {
      calls.head += 1;
      const main = shelf.get(key);
      if (!main) return null;
      if (main.length === 5 && main[0] === 2) {
        const parts = new DataView(main.buffer, main.byteOffset).getUint32(1, false);
        let bytes = 0;
        for (let i = 0; i < parts; i += 1) {
          const part = shelf.get(`${key}#${i}`);
          if (!part) return null;
          bytes += part.length;
        }
        return { bytes, parts };
      }
      return { bytes: main.length, parts: 0 };
    },
    async latestSnapshot(schemaVersion: number) {
      return snapshots.get(schemaVersion) ?? null;
    },
    async publishSnapshot(meta: Omit<SnapshotMeta, "createdAt">) {
      const existing = snapshots.get(meta.schemaVersion);
      if (existing && existing.frontierSeq >= meta.frontierSeq && existing.blobKey !== meta.blobKey) {
        return "conflict" as const;
      }
      if (existing && existing.blobKey !== meta.blobKey) shelf.delete(existing.blobKey);
      snapshots.set(meta.schemaVersion, { ...meta, createdAt: new Date(0).toISOString() });
      return "published" as const;
    },
    async deleteBlob(key: string) {
      shelf.delete(key);
    },
    async putBlob(key: string, bytes: Uint8Array) {
      shelf.set(key, bytes);
    },
    async getBlob(key: string) {
      return shelf.get(key) ?? null;
    },
    // Chunked transport, faked the way the relay implements it: parts stage
    // at `key#i`, commit publishes the [2][partCount u32be] descriptor.
    async putBlobPart(key: string, index: number, _parts: number, bytes: Uint8Array) {
      shelf.set(`${key}#${index}`, bytes);
    },
    async commitBlob(key: string, parts: number) {
      for (let i = 0; i < parts; i += 1) {
        if (!shelf.has(`${key}#${i}`))
          throw Object.assign(new Error(`relay 400: missing staged part ${i}`), { status: 400 });
      }
      const descriptor = new Uint8Array(5);
      descriptor[0] = 2;
      new DataView(descriptor.buffer).setUint32(1, parts, false);
      shelf.set(key, descriptor);
    },
    async getBlobPart(key: string, index: number) {
      const part = shelf.get(`${key}#${index}`);
      if (!part) throw Object.assign(new Error("relay 404: no such blob"), { status: 404 });
      return part;
    },
  };
  return api;
}

export function engineFor(
  device: ReturnType<typeof fakeDevice>,
  relay: SyncRelayApi,
  k: Uint8Array = testMasterKey,
  options: {
    batchSize?: number;
    blobChunkBytes?: number;
    checkpointPublish?: { minEvents?: number; everyEvents?: number; retryMs?: number };
  } = {},
) {
  return createSyncEngine({
    store: device.store,
    relay,
    masterKey: () => k,
    observe: (stamps) => device.observed.push(...stamps),
    batchSize: options.batchSize ?? 2, // small on purpose: exercise batching/pagination
    blobChunkBytes: options.blobChunkBytes,
    // Publishing is off by default in the harness (thresholds nobody reaches),
    // so the pre-existing suites see the cycle they always did.
    checkpointPublish: options.checkpointPublish ?? { minEvents: 1_000_000 },
  });
}
