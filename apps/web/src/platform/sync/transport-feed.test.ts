/**
 * The transport feed adapter (dumb per-device batches → the engine's numbered
 * mailbox) and the transport passphrase ritual — plus the same two-device
 * convergence harness the relay path is proven on, run against the REAL
 * engine over an in-memory dumb-storage session.
 */
import { describe, expect, test } from "bun:test";
import type {
  PluginSyncTransportSession,
  SealedEventWire,
} from "@read-aware/plugin-types";
import { deriveMasterKey } from "../sync-envelope";
import {
  establishEncryptionWithStore,
  transportKeyMaterialStore,
  WrongPassphraseError,
} from "./connect";
import {
  createTransportFeedRelay,
  type TransportFeedJournal,
  type TransportFeedStore,
} from "./transport-feed";
import { engineFor, fakeDevice, plain, TEST_KDF } from "./sync-test-kit";

const sealedStub = (id: string, deviceId = "dev-a"): SealedEventWire => ({
  id,
  hlc: { wallMs: 1, counter: 0, deviceId },
  v: 1,
  nonce: "bm9uY2U=",
  ciphertext: "Y2lwaGVy",
});

/** In-memory dumb storage honoring the transport contract. */
function fakeSession(endpointId = "reader@dav.test/base") {
  const batches = new Map<string, SealedEventWire[][]>();
  const metas = new Map<string, Uint8Array>();
  const shelf = new Map<string, Uint8Array>();
  const calls = { list: 0, getBatch: 0 };

  const session: PluginSyncTransportSession = {
    endpointId,
    async probe() {},
    async getMeta(name) {
      return metas.get(name) ?? null;
    },
    async putMetaIfAbsent(name, bytes) {
      if (metas.has(name)) return "exists";
      metas.set(name, bytes);
      return "stored";
    },
    async listEventBatches() {
      calls.list += 1;
      return [...batches.entries()]
        .filter(([, list]) => list.length > 0)
        .map(([deviceId, list]) => ({ deviceId, count: list.length }));
    },
    async getEventBatch(deviceId, index) {
      calls.getBatch += 1;
      return batches.get(deviceId)?.[index] ?? [];
    },
    async putEventBatch(deviceId, index, events) {
      const list = batches.get(deviceId) ?? [];
      if (list.length !== index) {
        throw new Error(`stale push index ${index}, remote holds ${list.length}`);
      }
      list.push(events);
      batches.set(deviceId, list);
    },
    async putBlob(key, bytes) {
      shelf.set(key, bytes);
    },
    async getBlob(key) {
      return shelf.get(key) ?? null;
    },
    async putBlobPart(key, index, _parts, bytes) {
      shelf.set(`${key}#${index}`, bytes);
    },
    async commitBlob(key, parts) {
      for (let i = 0; i < parts; i += 1) {
        if (!shelf.has(`${key}#${i}`)) throw new Error(`missing part ${i}`);
      }
      const descriptor = new Uint8Array(5);
      descriptor[0] = 2;
      new DataView(descriptor.buffer).setUint32(1, parts, false);
      shelf.set(key, descriptor);
    },
    async getBlobPart(key, index) {
      const part = shelf.get(`${key}#${index}`);
      if (!part) throw new Error("no such part");
      return part;
    },
  };
  return { session, batches, metas, shelf, calls };
}

function memoryStore(): TransportFeedStore & { journal: TransportFeedJournal | null } {
  const holder: { journal: TransportFeedJournal | null } = { journal: null };
  return {
    get journal() {
      return holder.journal;
    },
    set journal(value) {
      holder.journal = value;
    },
    load: () => holder.journal,
    save(journal) {
      // Deep copy: the adapter mutates its working object.
      holder.journal = JSON.parse(JSON.stringify(journal)) as TransportFeedJournal;
    },
  };
}

function feedFor(
  remote: ReturnType<typeof fakeSession>,
  deviceId: string,
  store: TransportFeedStore = memoryStore(),
) {
  return createTransportFeedRelay({
    session: async () => remote.session,
    deviceId,
    endpointId: remote.session.endpointId,
    store,
  });
}

describe("transport feed: push", () => {
  test("assigns dense batch indexes derived from the remote listing", async () => {
    const remote = fakeSession();
    remote.batches.set("dev-a", [[sealedStub("old")]]);
    const feed = feedFor(remote, "dev-a");
    const seqs = await feed.pushEvents([sealedStub("e1"), sealedStub("e2")]);
    expect(remote.batches.get("dev-a")).toHaveLength(2);
    expect(Object.keys(seqs).sort()).toEqual(["e1", "e2"]);
    await feed.pushEvents([sealedStub("e3")]);
    expect(remote.batches.get("dev-a")).toHaveLength(3);
  });

  test("re-derives the push index from the listing after a failure", async () => {
    const remote = fakeSession();
    const feed = feedFor(remote, "dev-a");
    await feed.pushEvents([sealedStub("e1")]);
    // Another actor (a lost-ack ghost of ourselves) appended batch 1.
    remote.batches.get("dev-a")!.push([sealedStub("ghost")]);
    await expect(feed.pushEvents([sealedStub("e2")])).rejects.toThrow(/stale push index/);
    // The retry lists again and lands on the next free index.
    await feed.pushEvents([sealedStub("e2")]);
    expect(remote.batches.get("dev-a")).toHaveLength(3);
  });
});

describe("transport feed: pull", () => {
  test("serves foreign batches in journal order and skips its own", async () => {
    const remote = fakeSession();
    remote.batches.set("dev-a", [[sealedStub("mine")]]);
    remote.batches.set("dev-b", [[sealedStub("b1", "dev-b"), sealedStub("b2", "dev-b")]]);
    remote.batches.set("dev-c", [[sealedStub("c1", "dev-c")]]);
    const feed = feedFor(remote, "dev-a");
    const page = await feed.pullEvents(0, 10);
    expect(page.events.map((event) => event.id).sort()).toEqual(["b1", "b2", "c1"]);
    // The cursor is batch-granular: all three journal entries are consumed.
    expect(page.next).toBe(3);
    const done = await feed.pullEvents(page.next, 10);
    expect(done.events).toEqual([]);
    expect(done.next).toBe(3);
  });

  test("re-serving the same cursor yields the same events (crash replay)", async () => {
    const remote = fakeSession();
    remote.batches.set("dev-b", [
      [sealedStub("b1", "dev-b")],
      [sealedStub("b2", "dev-b")],
    ]);
    const store = memoryStore();
    const feed = feedFor(remote, "dev-a", store);
    const first = await feed.pullEvents(0, 1);
    const again = await feed.pullEvents(0, 1);
    expect(again.events.map((e) => e.id)).toEqual(first.events.map((e) => e.id));
    expect(again.next).toBe(first.next);
  });

  test("fills a page across batches so a short page really means the end", async () => {
    const remote = fakeSession();
    remote.batches.set("dev-b", [
      [sealedStub("b1", "dev-b")],
      [sealedStub("b2", "dev-b")],
      [sealedStub("b3", "dev-b")],
    ]);
    const feed = feedFor(remote, "dev-a");
    const page = await feed.pullEvents(0, 2);
    expect(page.events).toHaveLength(2);
    expect(page.next).toBe(2);
  });

  test("refreshes the listing before ever declaring a short page", async () => {
    const remote = fakeSession();
    remote.batches.set("dev-b", [[sealedStub("b1", "dev-b")]]);
    const store = memoryStore();
    const feed = feedFor(remote, "dev-a", store);
    await feed.pullEvents(0, 10);
    // New remote data lands between cycles; the journal is stale.
    remote.batches.get("dev-b")!.push([sealedStub("b2", "dev-b")]);
    const page = await feed.pullEvents(1, 10);
    expect(page.events.map((e) => e.id)).toEqual(["b2"]);
  });

  test("a lost journal clamps the cursor and re-serves idempotently", async () => {
    const remote = fakeSession();
    remote.batches.set("dev-b", [[sealedStub("b1", "dev-b")]]);
    const store = memoryStore();
    const feed = feedFor(remote, "dev-a", store);
    const page = await feed.pullEvents(0, 10);
    expect(page.next).toBe(1);
    // Bookkeeping wiped (KV cleared); the engine's cursor survives at 1.
    (store as { journal: TransportFeedJournal | null }).journal = null;
    const replayed = await feedFor(remote, "dev-a", store).pullEvents(5, 10);
    expect(replayed.events.map((e) => e.id)).toEqual(["b1"]);
  });

  test("serves known journal entries without touching the remote listing", async () => {
    const remote = fakeSession();
    remote.batches.set("dev-b", [
      [sealedStub("b1", "dev-b")],
      [sealedStub("b2", "dev-b")],
    ]);
    const store = memoryStore();
    const feed = feedFor(remote, "dev-a", store);
    await feed.pullEvents(0, 10);
    const listingsBefore = remote.calls.list;
    // A crash-replay of an already-journaled position needs no listing.
    await feed.pullEvents(0, 2);
    expect(remote.calls.list).toBe(listingsBefore);
  });
});

describe("transport key material", () => {
  const derive = (p: string, s: string) => deriveMasterKey(p, s, TEST_KDF);

  test("first device mints and publishes; the second verifies with the same passphrase", async () => {
    const remote = fakeSession();
    const store = transportKeyMaterialStore(remote.session);
    const first = await establishEncryptionWithStore(store, "共享口令", {
      derive,
      kdfParams: TEST_KDF,
    });
    const second = await establishEncryptionWithStore(store, "共享口令", { derive });
    expect(second).toBe(first);
  });

  test("a wrong passphrase fails loudly against published material", async () => {
    const remote = fakeSession();
    const store = transportKeyMaterialStore(remote.session);
    await establishEncryptionWithStore(store, "正确口令", { derive, kdfParams: TEST_KDF });
    await expect(
      establishEncryptionWithStore(store, "错误口令", { derive }),
    ).rejects.toThrow(WrongPassphraseError);
  });

  test("losing the publish race adopts the winner's material", async () => {
    const remote = fakeSession();
    const winner = transportKeyMaterialStore(remote.session);
    const winnerKey = await establishEncryptionWithStore(winner, "共享口令", {
      derive,
      kdfParams: TEST_KDF,
    });
    // The loser raced past `load()` before the winner published: its
    // publish must come back "exists" and verify against the winner's salt.
    const loser = transportKeyMaterialStore({
      getMeta: async (name) => {
        return remote.session.getMeta(name);
      },
      putMetaIfAbsent: remote.session.putMetaIfAbsent,
    });
    const loserKey = await establishEncryptionWithStore(loser, "共享口令", {
      derive,
      kdfParams: TEST_KDF,
    });
    expect(loserKey).toBe(winnerKey);
  });

  test("corrupt key material fails closed instead of minting over it", async () => {
    const remote = fakeSession();
    remote.metas.set("keys", new TextEncoder().encode("{not json"));
    const store = transportKeyMaterialStore(remote.session);
    await expect(
      establishEncryptionWithStore(store, "任意口令", { derive }),
    ).rejects.toThrow(/not valid JSON/);
  });
});

describe("two devices over dumb storage", () => {
  test("bidirectional convergence and blob flow through the real engine", async () => {
    const remote = fakeSession();
    const deviceA = fakeDevice();
    const deviceB = fakeDevice();
    const engineA = engineFor(deviceA, feedFor(remote, "device-a"));
    const engineB = engineFor(deviceB, feedFor(remote, "device-b"));

    for (let i = 1; i <= 5; i += 1) {
      deviceA.commitLocal(plain(`a${i}`, 1_000 + i, "device-a", `甲${i}`));
    }
    for (let i = 1; i <= 3; i += 1) {
      deviceB.commitLocal(plain(`b${i}`, 2_000 + i, "device-b", `乙${i}`));
    }
    deviceA.putLocalBlob("bookfile:shared", new TextEncoder().encode("整本书的字节"));

    // Two rounds: round one exchanges what each side held; round two picks up
    // what the other side pushed during round one.
    await engineA.syncOnce();
    await engineB.syncOnce();
    await engineA.syncOnce();

    const idsA = deviceA.applied.map((event) => event.id).sort();
    const idsB = deviceB.applied.map((event) => event.id).sort();
    expect(idsA).toEqual(["a1", "a2", "a3", "a4", "a5", "b1", "b2", "b3"]);
    expect(idsB).toEqual(idsA);
    expect(deviceA.outbox).toEqual([]);
    expect(deviceB.outbox).toEqual([]);

    // The blob rode along sealed; B fetches and decrypts it lazily.
    expect(await engineB.fetchBlob("bookfile:shared")).toBe("fetched");
    expect(new TextDecoder().decode(deviceB.blobs.get("bookfile:shared")!)).toBe(
      "整本书的字节",
    );

    // Nothing on the remote is plaintext: not the events, not the blob.
    const everything = [
      ...[...remote.batches.values()].flat().flatMap((batch) =>
        batch.map((event) => JSON.stringify(event)),
      ),
      ...[...remote.shelf.values()].map((bytes) => new TextDecoder().decode(bytes)),
    ].join("\n");
    expect(everything).not.toContain("甲");
    expect(everything).not.toContain("乙");
    expect(everything).not.toContain("整本书");
    expect(everything).not.toContain("highlight.created");
  });

  test("a bootstrap device replays the whole history from the remote", async () => {
    const remote = fakeSession();
    const deviceA = fakeDevice();
    const engineA = engineFor(deviceA, feedFor(remote, "device-a"));
    for (let i = 1; i <= 7; i += 1) {
      deviceA.commitLocal(plain(`a${i}`, 1_000 + i, "device-a", `第${i}条`));
    }
    await engineA.syncOnce();

    const fresh = fakeDevice();
    const engineFresh = engineFor(fresh, feedFor(remote, "device-new"));
    await engineFresh.syncOnce();
    expect(fresh.applied.map((event) => event.id).sort()).toEqual(
      ["a1", "a2", "a3", "a4", "a5", "a6", "a7"],
    );
  });
});
