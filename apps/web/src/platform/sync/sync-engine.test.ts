import { describe, expect, test } from "bun:test";
import type { HlcStamp } from "@read-aware/core";
import { deriveMasterKey, sealEvent, type PlainEvent } from "../sync-envelope";
import { establishEncryption, verifySignInToken, WrongPassphraseError } from "./connect";
import { RelayError } from "./relay-client";
import {
  createSyncEngine,
  nextSyncDelayMs,
  type MergeReport,
  type SyncCycleProgress,
  type SyncLocalStore,
  type SyncRelayApi,
} from "./sync-engine";

const TEST_KDF = { algo: "argon2id", t: 1, m: 16, p: 1 } as const;
const key = deriveMasterKey("同一个口令", "c2FsdHNhbHRzYWx0c2FsdA==", TEST_KDF);

function plain(id: string, wallMs: number, deviceId: string, text: string): PlainEvent {
  return {
    id,
    type: "highlight.created",
    hlc: { wallMs, counter: 0, deviceId },
    payload: { highlightId: id, bookId: "b1", text },
  };
}

/** A fake device: outbox + applied log + blob shelf, with recording. */
function fakeDevice() {
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
      const staged: Uint8Array[] = [];
      return {
        async append(bytes: Uint8Array) {
          staged.push(bytes);
        },
        async commit() {
          const total = staged.reduce((sum, c) => sum + c.length, 0);
          const joined = new Uint8Array(total);
          let offset = 0;
          for (const c of staged) {
            joined.set(c, offset);
            offset += c.length;
          }
          blobs.set(k, joined);
          blobOutbox.add(k);
        },
        async abort() {
          staged.length = 0;
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
function fakeRelay(): SyncRelayApi & { count(): number; failNextPush?: boolean } {
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
        if (!shelf.has(`${key}#${i}`)) throw Object.assign(new Error(`relay 400: missing staged part ${i}`), { status: 400 });
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

function engineFor(device: ReturnType<typeof fakeDevice>, relay: SyncRelayApi, k = key) {
  return createSyncEngine({
    store: device.store,
    relay,
    masterKey: () => k,
    observe: (stamps) => device.observed.push(...stamps),
    batchSize: 2, // small on purpose: exercise batching/pagination
  });
}

describe("push", () => {
  test("drains the outbox in batches and acknowledges assigned seqs", async () => {
    const relay = fakeRelay();
    const device = fakeDevice();
    for (let i = 1; i <= 5; i += 1) device.commitLocal(plain(`e${i}`, 1_000 + i, "device-a", "…"));

    const pushed = await engineFor(device, relay).pushOnce();
    expect(pushed).toBe(5);
    expect(device.outbox).toEqual([]);
    expect(relay.count()).toBe(5);
  });

  test("a relay failure marks the batch failed and surfaces the error", async () => {
    const relay = fakeRelay();
    const device = fakeDevice();
    device.commitLocal(plain("e1", 1_001, "device-a", "…"));
    relay.failNextPush = true;

    await expect(engineFor(device, relay).pushOnce()).rejects.toThrow("relay 503");
    expect(device.failed.get("e1")).toBe("relay 503");
    // The outbox still owns the event; the next pass retries it.
    expect(device.outbox.length).toBe(1);
    await engineFor(device, relay).pushOnce();
    expect(device.outbox.length).toBe(0);
  });

  test("without a master key nothing moves", async () => {
    const device = fakeDevice();
    device.commitLocal(plain("e1", 1_001, "device-a", "…"));
    const engine = createSyncEngine({
      store: device.store,
      relay: fakeRelay(),
      masterKey: () => null,
      observe: () => {},
    });
    await expect(engine.pushOnce()).rejects.toThrow(/no master key/);
    expect(device.outbox.length).toBe(1);
  });
});

describe("pull", () => {
  test("pages through the feed, observes clocks BEFORE applying, advances the cursor", async () => {
    const relay = fakeRelay();
    const producer = fakeDevice();
    for (let i = 1; i <= 5; i += 1) {
      producer.commitLocal(plain(`e${i}`, 2_000 + i, "device-b", `第${i}条`));
    }
    await engineFor(producer, relay).pushOnce();

    const consumer = fakeDevice();
    const merged = await engineFor(consumer, relay).pullOnce();
    expect(merged).toBe(5);
    expect(consumer.applied.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4", "e5"]);
    expect(consumer.applied[2].payload).toEqual({
      highlightId: "e3",
      bookId: "b1",
      text: "第3条",
    });
    expect(consumer.observed.length).toBe(5);
    expect(consumer.cursorValue()).toBe(5);

    // Nothing new: the cursor holds still and nothing re-applies.
    expect(await engineFor(consumer, relay).pullOnce()).toBe(0);
    expect(consumer.applied.length).toBe(5);
  });

  test("a backlog behind the frontier stages later pages and replays once at the end", async () => {
    const relay = fakeRelay();
    const producer = fakeDevice();
    // 7 events at batchSize 2 = 4 pages (2+2+2+1).
    for (let i = 1; i <= 7; i += 1) {
      producer.commitLocal(plain(`e${i}`, 2_000 + i, "device-b", `第${i}条`));
    }
    await engineFor(producer, relay).pushOnce();

    // The consumer has its own newer history: every pulled page lands behind
    // its frontier, so applyRemote reports the replay fallback.
    const consumer = fakeDevice();
    consumer.controls.replayOnApply = true;
    const merged = await engineFor(consumer, relay).pullOnce();
    expect(merged).toBe(7);
    // Page 1 applied (and replayed) — then the loop switches to staging.
    expect(consumer.controls.applyCalls).toBe(1);
    expect(consumer.controls.stageCalls).toBe(3);
    // One defensive finalize at the start + ONE finishing replay at the end.
    expect(consumer.controls.finalizeCalls).toBe(2);
    expect(consumer.staged).toEqual([]);
    expect(consumer.applied.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4", "e5", "e6", "e7"]);
    expect(consumer.cursorValue()).toBe(7);
  });

  test("a replayed FINAL page never enters staging mode", async () => {
    const relay = fakeRelay();
    const producer = fakeDevice();
    producer.commitLocal(plain("e1", 2_001, "device-b", "唯一一条"));
    await engineFor(producer, relay).pushOnce();

    const consumer = fakeDevice();
    consumer.controls.replayOnApply = true;
    await engineFor(consumer, relay).pullOnce();
    // A short (< batchSize) page is the last one — nothing follows that could
    // amortize, so it applies directly and only the defensive finalize ran.
    expect(consumer.controls.applyCalls).toBe(1);
    expect(consumer.controls.stageCalls).toBe(0);
    expect(consumer.controls.finalizeCalls).toBe(1);
  });

  test("the wrong key fails loudly instead of merging garbage", async () => {
    const relay = fakeRelay();
    const producer = fakeDevice();
    producer.commitLocal(plain("e1", 2_001, "device-b", "秘密"));
    await engineFor(producer, relay).pushOnce();

    const eavesdropper = fakeDevice();
    const wrongKey = deriveMasterKey("错误口令", "c2FsdHNhbHRzYWx0c2FsdA==", TEST_KDF);
    await expect(engineFor(eavesdropper, relay, wrongKey).pullOnce()).rejects.toThrow();
    expect(eavesdropper.applied).toEqual([]);
  });
});

describe("two devices through one relay", () => {
  test("converge on the same applied set regardless of who syncs first", async () => {
    const relay = fakeRelay();
    const a = fakeDevice();
    const b = fakeDevice();
    a.commitLocal(plain("a1", 1_000, "device-a", "A 的高亮"));
    a.commitLocal(plain("a2", 1_500, "device-a", "A 的第二条"));
    b.commitLocal(plain("b1", 2_000, "device-b", "B 的高亮"));

    const engineA = engineFor(a, relay);
    const engineB = engineFor(b, relay);
    await engineA.syncOnce(); // A: pull(0) → push a1,a2
    await engineB.syncOnce(); // B: pull a1,a2 → push b1
    await engineA.syncOnce(); // A: pull b1

    const ids = (d: ReturnType<typeof fakeDevice>) => d.applied.map((e) => e.id).sort();
    expect(ids(a)).toEqual(["a1", "a2", "b1"]);
    expect(ids(b)).toEqual(["a1", "a2", "b1"]);
    // Neither device ever re-pushed what it pulled (no echo).
    expect(relay.count()).toBe(3);
  });

  test("blobs ride the same relay: push from A, lazy fetch on B", async () => {
    const relay = fakeRelay();
    const a = fakeDevice();
    const b = fakeDevice();
    const bytes = new TextEncoder().encode("epub 字节内容");
    a.putLocalBlob("bookfile:b1", bytes);

    expect(await engineFor(a, relay).syncBlobsOnce()).toBe(1);
    expect(a.blobStates.get("bookfile:b1")).toBe("synced");

    expect(await engineFor(b, relay).fetchBlob("bookfile:b1")).toBe("fetched");
    expect([...(b.blobs.get("bookfile:b1") ?? [])]).toEqual([...bytes]);
    // The local write enqueued it; fetchBlob must flip it straight to synced.
    expect(b.blobStates.get("bookfile:b1")).toBe("synced");
    expect(b.blobOutbox.size).toBe(0);

    expect(await engineFor(b, relay).fetchBlob("bookfile:missing")).toBe("absent");
  });

  test("a blob over one chunk uploads as sealed parts and downloads back whole", async () => {
    const relay = fakeRelay();
    const a = fakeDevice();
    const b = fakeDevice();
    // 3 chunks at the test chunk size: 16 + 16 + 9 bytes of plaintext.
    const chunkBytes = 16;
    const plain = new Uint8Array(41).map((_, i) => (i * 7) % 256);
    a.putLocalBlob("bookfile:big", plain);

    const seen: SyncCycleProgress[] = [];
    const engineA = createSyncEngine({
      store: a.store,
      relay,
      masterKey: () => key,
      observe: () => {},
      blobChunkBytes: chunkBytes,
      onProgress: (p) => seen.push({ ...p }),
    });
    expect(await engineA.syncBlobsOnce()).toBe(1);
    expect(a.blobStates.get("bookfile:big")).toBe("synced");
    // Part progress was narrated with the blob's identity attached.
    expect(seen.some((p) => p.blobKey === "bookfile:big" && p.blobPartsTotal === 3)).toBe(true);
    expect(Math.max(...seen.map((p) => p.blobPartsDone))).toBe(3);

    // Device B reassembles through its staged writer — chunk size is NOT
    // negotiated: the descriptor + per-part AAD carry everything needed.
    const engineB = engineFor(b, relay);
    expect(await engineB.fetchBlob("bookfile:big")).toBe("fetched");
    expect([...(b.blobs.get("bookfile:big") ?? [])]).toEqual([...plain]);
    expect(b.blobStates.get("bookfile:big")).toBe("synced");
  });

  test("a corrupted part aborts the staged write and leaves no local blob", async () => {
    const relay = fakeRelay();
    const a = fakeDevice();
    const b = fakeDevice();
    const plain = new Uint8Array(40).fill(5);
    a.putLocalBlob("bookfile:big", plain);
    const engineA = createSyncEngine({
      store: a.store,
      relay,
      masterKey: () => key,
      observe: () => {},
      blobChunkBytes: 16,
    });
    await engineA.syncBlobsOnce();

    const corrupting: SyncRelayApi = {
      ...relay,
      async getBlobPart(key, index) {
        const part = await relay.getBlobPart(key, index);
        if (index === 1) part[part.length - 1] ^= 0x01;
        return part;
      },
    };
    await expect(engineFor(b, corrupting).fetchBlob("bookfile:big")).rejects.toThrow();
    expect(b.blobs.has("bookfile:big")).toBe(false);
    expect(b.blobStates.get("bookfile:big")).toBeUndefined();
  });

  test("a 4xx refusal is terminal, a 5xx stays queued, and neither dams the queue", async () => {
    const relay = fakeRelay();
    const refusing: SyncRelayApi = {
      ...relay,
      async putBlob(key, bytes) {
        if (key === "bookfile:huge") throw new RelayError(413, "blob exceeds the size cap");
        if (key === "bookfile:flaky") throw new RelayError(503, "relay hiccup");
        return relay.putBlob(key, bytes);
      },
    };
    const a = fakeDevice();
    a.putLocalBlob("bookfile:huge", new Uint8Array(10));
    a.putLocalBlob("bookfile:flaky", new Uint8Array(10));
    a.putLocalBlob("bookfile:ok", new Uint8Array(10));

    const uploaded = await engineFor(a, refusing).syncBlobsOnce();
    expect(uploaded).toBe(1);
    // The relay's final word: out of the outbox, never re-uploaded.
    expect(a.blobStates.get("bookfile:huge")).toContain("rejected");
    expect(a.blobOutbox.has("bookfile:huge")).toBe(false);
    // Transient: stays queued for the next cycle.
    expect(a.blobStates.get("bookfile:flaky")).toContain("failed");
    expect(a.blobOutbox.has("bookfile:flaky")).toBe(true);
    expect(a.blobStates.get("bookfile:ok")).toBe("synced");
  });
});

describe("connect flow", () => {
  const material = new Map<
    string,
    { kdfSalt: string; kdfParams: typeof TEST_KDF; keyCheck: string }
  >();
  function fakeAuthRelay(accountId: string) {
    // Session enforcement mirrors production: publishKeys is an authed call,
    // and the session only exists AFTER verify — a connect flow that hands
    // phase 2 a client not serving the fresh session must fail here too.
    let servedSession: string | null = null;
    return {
      /** What useSyncConnection wires into the phase-2 relay client. */
      serveSession: (session: string | null) => {
        servedSession = session;
      },
      async verifyMagicLink(_token: string) {
        return {
          session: "sess",
          accountId,
          email: `${accountId}@example.com`,
          keys: material.get(accountId) ?? null,
        };
      },
      async publishKeys(keys: { kdfSalt: string; kdfParams: typeof TEST_KDF; keyCheck: string }) {
        if (servedSession !== "sess") throw new Error("relay 401: authentication required");
        if (material.has(accountId)) {
          return { outcome: "conflict" as const, keys: material.get(accountId) ?? null };
        }
        material.set(accountId, keys);
        return { outcome: "set" as const };
      },
    };
  }
  const derive = (p: string, s: string) => deriveMasterKey(p, s, TEST_KDF);

  test("phase 1 reports the account email — the identity the UI must show", async () => {
    const relay = fakeAuthRelay("acc-1");
    const verification = await verifySignInToken(relay, "t1");
    expect(verification.email).toBe("acc-1@example.com");
    expect(verification.keys).toBeNull();
  });

  test("first device mints; second device with the right passphrase joins; wrong one is refused", async () => {
    material.clear();
    const relay = fakeAuthRelay("acc-1");
    const firstVerification = await verifySignInToken(relay, "t1");
    relay.serveSession(firstVerification.session);
    const first = await establishEncryption(relay, firstVerification, "鲸鱼在唱歌", { derive });

    const secondVerification = await verifySignInToken(relay, "t2");
    relay.serveSession(secondVerification.session);
    const second = await establishEncryption(relay, secondVerification, "鲸鱼在唱歌", { derive });
    expect(second).toBe(first);

    const thirdVerification = await verifySignInToken(relay, "t3");
    relay.serveSession(thirdVerification.session);
    await expect(
      establishEncryption(relay, thirdVerification, "打错了", { derive }),
    ).rejects.toThrow(WrongPassphraseError);
  });

  test("the first device's key publish already carries the fresh session", async () => {
    material.clear();
    const relay = fakeAuthRelay("acc-3");
    const verification = await verifySignInToken(relay, "t");
    // No serveSession — the exact regression that burned a live sign-in
    // token on first deploy: publishing before the session is served 401s.
    await expect(establishEncryption(relay, verification, "鲸鱼在唱歌", { derive })).rejects.toThrow(
      /401/,
    );
  });

  test("losing the publish race falls back to verifying the winner's material", async () => {
    material.clear();
    // The "winner" publishes between our verify and publish: simulate by
    // pre-seeding material with the SAME passphrase but a different salt.
    const winnerSalt = "d2lubmVyc2FsdHNhbHQ=";
    const winnerKey = deriveMasterKey("共享口令", winnerSalt, TEST_KDF);
    const { makeKeyCheck } = await import("../sync-envelope");
    const race = {
      async verifyMagicLink() {
        return { session: "sess", accountId: "acc-2", email: "acc-2@example.com", keys: null }; // looked empty…
      },
      async publishKeys() {
        // …but someone else landed first.
        return {
          outcome: "conflict" as const,
          keys: { kdfSalt: winnerSalt, kdfParams: TEST_KDF, keyCheck: makeKeyCheck(winnerKey) },
        };
      },
    };
    const verification = await verifySignInToken(race, "t");
    const result = await establishEncryption(race, verification, "共享口令", { derive });
    // The loser ends with the WINNER's key (their salt), not its own minting.
    expect(result).toBe(Buffer.from(winnerKey).toString("base64"));
  });
});

describe("retry pacing", () => {
  test("exponential from base, capped", () => {
    expect(nextSyncDelayMs(0)).toBe(5 * 60_000);
    expect(nextSyncDelayMs(1)).toBe(10 * 60_000);
    expect(nextSyncDelayMs(2)).toBe(20 * 60_000);
    expect(nextSyncDelayMs(3)).toBe(30 * 60_000);
    expect(nextSyncDelayMs(10)).toBe(30 * 60_000);
    expect(nextSyncDelayMs(1, { baseMs: 1_000, maxMs: 3_000 })).toBe(2_000);
  });
});
