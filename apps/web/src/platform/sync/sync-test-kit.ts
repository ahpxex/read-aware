/**
 * Shared fixtures for the sync suites (`sync-engine.test.ts`,
 * `transport-feed.test.ts`): a fake device (local store + recording), a fake
 * relay (numbered mailbox + blob shelf), and the tiny KDF/test key. Extracted
 * so the plugin-transport suite exercises the REAL engine against the REAL
 * feed adapter with the same two-device harness the relay path is proven on.
 */
import type { HlcStamp } from "@read-aware/core";
import { deriveMasterKey, sealEvent, type PlainEvent } from "../sync-envelope";
import {
  createSyncEngine,
  type MergeReport,
  type SyncLocalStore,
  type SyncRelayApi,
} from "./sync-engine";

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
  // Test control: make applyRemote report the replay fallback (events behind
  // the local frontier), which is what flips the pull loop into staging.
  const controls = { replayOnApply: false, applyCalls: 0, stageCalls: 0, finalizeCalls: 0 };

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
    async applyRemote(events): Promise<MergeReport> {
      controls.applyCalls += 1;
      let appended = 0;
      for (const event of events) {
        if (knownIds.has(event.id)) continue;
        knownIds.add(event.id);
        applied.push(event);
        appended += 1;
      }
      return { appended, applied: appended, replayed: controls.replayOnApply };
    },
    async stageRemote(events) {
      controls.stageCalls += 1;
      let appended = 0;
      for (const event of events) {
        if (knownIds.has(event.id)) continue;
        knownIds.add(event.id);
        staged.push(event);
        appended += 1;
      }
      return appended;
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
export function fakeRelay(): SyncRelayApi & { count(): number; failNextPush?: boolean } {
  const rows: Array<{ seq: number; sealed: ReturnType<typeof sealEvent> }> = [];
  const byId = new Map<string, number>();
  const shelf = new Map<string, Uint8Array>();
  const api = {
    failNextPush: false,
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
      const page = rows.filter((r) => r.seq > after).slice(0, limit);
      return {
        events: page.map((r) => r.sealed),
        next: page.length ? page[page.length - 1].seq : after,
      };
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
  options: { batchSize?: number; blobChunkBytes?: number } = {},
) {
  return createSyncEngine({
    store: device.store,
    relay,
    masterKey: () => k,
    observe: (stamps) => device.observed.push(...stamps),
    batchSize: options.batchSize ?? 2, // small on purpose: exercise batching/pagination
    blobChunkBytes: options.blobChunkBytes,
  });
}
