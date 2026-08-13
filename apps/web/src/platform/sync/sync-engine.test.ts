import { describe, expect, test } from "bun:test";
import type { HlcStamp } from "@read-aware/core";
import { deriveMasterKey, sealEvent, type PlainEvent } from "../sync-envelope";
import { connectAccount, WrongPassphraseError } from "./connect";
import { RelayError } from "./relay-client";
import {
  createSyncEngine,
  nextSyncDelayMs,
  type MergeReport,
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
      let appended = 0;
      for (const event of events) {
        if (knownIds.has(event.id)) continue;
        knownIds.add(event.id);
        applied.push(event);
        appended += 1;
      }
      return { appended, applied: appended, replayed: false };
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

    const fetched = await engineFor(b, relay).fetchBlob("bookfile:b1");
    expect(fetched && [...fetched]).toEqual([...bytes]);
    expect([...(b.blobs.get("bookfile:b1") ?? [])]).toEqual([...bytes]);
    // The local write enqueued it; fetchBlob must flip it straight to synced.
    expect(b.blobStates.get("bookfile:b1")).toBe("synced");
    expect(b.blobOutbox.size).toBe(0);

    expect(await engineFor(b, relay).fetchBlob("bookfile:missing")).toBeNull();
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
  const material = new Map<string, { kdfSalt: string; kdfParams: typeof TEST_KDF; keyCheck: string }>();
  function fakeAuthRelay(accountId: string) {
    // Session enforcement mirrors production: publishKeys is an authed call,
    // and the session only exists AFTER verify — a connect flow that fails to
    // start serving the fresh session before publishing must fail here too
    // (the exact bug the first live connect hit).
    let sessionServed = false;
    return {
      markSessionServed: () => {
        sessionServed = true;
      },
      async verifyMagicLink(_token: string) {
        return { session: "sess", accountId, keys: material.get(accountId) ?? null };
      },
      async publishKeys(keys: { kdfSalt: string; kdfParams: typeof TEST_KDF; keyCheck: string }) {
        if (!sessionServed) throw new Error("relay 401: authentication required");
        if (material.has(accountId)) {
          return { outcome: "conflict" as const, keys: material.get(accountId) ?? null };
        }
        material.set(accountId, keys);
        return { outcome: "set" as const };
      },
    };
  }

  test("first device mints; second device with the right passphrase joins; wrong one is refused", async () => {
    material.clear();
    const relay = fakeAuthRelay("acc-1");
    const first = await connectAccount({
      relay,
      token: "t1",
      passphrase: "鲸鱼在唱歌",
      onSession: relay.markSessionServed,
      derive: (p, s) => deriveMasterKey(p, s, TEST_KDF),
    });
    const second = await connectAccount({
      relay,
      token: "t2",
      passphrase: "鲸鱼在唱歌",
      onSession: relay.markSessionServed,
      derive: (p, s) => deriveMasterKey(p, s, TEST_KDF),
    });
    expect(second.masterKeyBase64).toBe(first.masterKeyBase64);

    await expect(
      connectAccount({
        relay,
        token: "t3",
        passphrase: "打错了",
        onSession: relay.markSessionServed,
        derive: (p, s) => deriveMasterKey(p, s, TEST_KDF),
      }),
    ).rejects.toThrow(WrongPassphraseError);
  });

  test("the first device's key publish already carries the fresh session", async () => {
    material.clear();
    const relay = fakeAuthRelay("acc-3");
    // Without onSession wiring the publish goes out unauthenticated — the
    // regression that burned a live sign-in token on first deploy.
    await expect(
      connectAccount({
        relay,
        token: "t",
        passphrase: "鲸鱼在唱歌",
        derive: (p, s) => deriveMasterKey(p, s, TEST_KDF),
      }),
    ).rejects.toThrow(/401/);
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
        return { session: "sess", accountId: "acc-2", keys: null }; // looked empty…
      },
      async publishKeys() {
        // …but someone else landed first.
        return {
          outcome: "conflict" as const,
          keys: { kdfSalt: winnerSalt, kdfParams: TEST_KDF, keyCheck: makeKeyCheck(winnerKey) },
        };
      },
    };
    const result = await connectAccount({
      relay: race,
      token: "t",
      passphrase: "共享口令",
      derive: (p, s) => deriveMasterKey(p, s, TEST_KDF),
    });
    // The loser ends with the WINNER's key (their salt), not its own minting.
    expect(result.masterKeyBase64).toBe(
      Buffer.from(winnerKey).toString("base64"),
    );
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
