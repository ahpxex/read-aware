import { describe, expect, test } from "bun:test";
import { deriveMasterKey } from "../sync-envelope";
import {
  establishEncryption,
  InvalidSignInResponseError,
  verifySignInToken,
  WrongPassphraseError,
} from "./connect";
import { RelayError } from "./relay-client";
import {
  createSyncEngine,
  nextSyncDelayMs,
  type SyncCycleProgress,
  type SyncRelayApi,
} from "./sync-engine";

import {
  engineFor,
  fakeDevice,
  fakeRelay,
  plain,
  TEST_KDF,
  testMasterKey as key,
} from "./sync-test-kit";

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

  test("a quota refusal is retried once the account has room, covers first", async () => {
    const relay = fakeRelay();
    // A relay with a 100-byte cap that meters what it holds, like the real one.
    let capBytes = 100;
    const used = () => [...relay.shelf.values()].reduce((sum, b) => sum + b.length, 0);
    const metered: SyncRelayApi = {
      ...relay,
      async putBlob(key, bytes) {
        if (used() + bytes.length > capBytes) throw new RelayError(413, "account blob quota exceeded");
        return relay.putBlob(key, bytes);
      },
      async blobQuota() {
        return { usedBytes: used(), maxBytes: capBytes };
      },
    };
    const a = fakeDevice();
    a.putLocalBlob("bookfile:b1", new Uint8Array(40)); // seals to 81
    a.putLocalBlob("cover:b1", new Uint8Array(10)); // seals to 51
    const engine = engineFor(a, metered);
    // Only the first fits; the rest are refused for room and leave the outbox.
    expect(await engine.syncBlobsOnce()).toBe(1);
    expect(a.blobStates.get("bookfile:b1")).toBe("synced");
    expect(a.blobStates.get("cover:b1")).toBe("rejected: sync/quota");
    // No room yet: the refusal stands, nothing is re-uploaded into a 413.
    expect(await engine.syncBlobsOnce()).toBe(0);
    expect(a.blobStates.get("cover:b1")).toBe("rejected: sync/quota");
    // The account grows (a tier bought): the cover goes back in and lands.
    capBytes = 200;
    expect(await engine.syncBlobsOnce()).toBe(1);
    expect(a.blobStates.get("cover:b1")).toBe("synced");
    expect(relay.shelf.has("cover:b1")).toBe(true);
  });

  test("re-queueing is greedy against the headroom, covers before book files", async () => {
    const relay = fakeRelay();
    const quota: SyncRelayApi = {
      ...relay,
      async blobQuota() {
        return { usedBytes: 0, maxBytes: 120 };
      },
    };
    const a = fakeDevice();
    a.putLocalBlob("bookfile:b1", new Uint8Array(40)); // seals to 81
    a.putLocalBlob("cover:b1", new Uint8Array(10)); // seals to 51
    a.putLocalBlob("bookfile:b2", new Uint8Array(20)); // seals to 61
    await a.store.markBlobsRejected(["bookfile:b1", "cover:b1", "bookfile:b2"], "sync/quota");
    // 120 bytes of room: the cover (51) and then b2 (61) fit; b1 (81) does not.
    expect(await engineFor(a, quota).syncBlobsOnce()).toBe(2);
    expect(a.blobStates.get("cover:b1")).toBe("synced");
    expect(a.blobStates.get("bookfile:b2")).toBe("synced");
    expect(a.blobStates.get("bookfile:b1")).toBe("rejected: sync/quota");
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

  test("phase 1 fails closed when the relay omits or cannot visibly identify the account", async () => {
    for (const email of [
      undefined,
      "not-an-email",
      "\u200b@\u200b.\u200b",
      "\u034f@\u034f.\u034f",
    ]) {
      const malformedRelay = {
        async verifyMagicLink() {
          return {
            session: "sess",
            accountId: "acc-legacy",
            email: email as string,
            keys: null,
          };
        },
      };
      await expect(verifySignInToken(malformedRelay, "t1")).rejects.toThrow(
        InvalidSignInResponseError,
      );
    }
  });

  test("phase 1 treats invalid 2xx JSON as a consumed, malformed response", async () => {
    const malformedRelay = {
      async verifyMagicLink(): Promise<never> {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    };
    await expect(verifySignInToken(malformedRelay, "t1")).rejects.toThrow(
      InvalidSignInResponseError,
    );
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


describe("verification (the `unverified` bookkeeping) — never re-upload to find out", () => {
  test("a pull settles push bookkeeping from the seqs it carries", async () => {
    const relay = fakeRelay();
    const device = fakeDevice();
    const event = plain("e1", 2_001, "device-a", "一条");
    device.commitLocal(event);
    await engineFor(device, relay).pushOnce();
    expect(device.outbox).toEqual([]);
    // The ack was lost: the row is back in the outbox. The next pull hands
    // the event back WITH its seq — settled, nothing to push.
    device.outbox.push(event);
    await engineFor(device, relay).pullOnce();
    expect(device.outbox).toEqual([]);
    expect(device.remoteIds.get("e1")).toBe(1);
    expect(relay.count()).toBe(1);
  });

  test("an account adoption verifies by id and HEAD; only what is truly absent is pushed", async () => {
    const relay = fakeRelay();
    const device = fakeDevice();
    for (let i = 1; i <= 5; i += 1) device.commitLocal(plain(`e${i}`, 2_000 + i, "device-a", `第${i}条`));
    device.putLocalBlob("bookfile:b1", new Uint8Array(100));
    device.putLocalBlob("bookfile:b2", new Uint8Array(3_000)); // > chunk: v2
    const engine = engineFor(device, relay, undefined, { blobChunkBytes: 1_000 });
    await engine.pushOnce();
    await engine.syncBlobsOnce();
    expect(relay.count()).toBe(5);
    // Something the relay never got, and a blob whose remote copy is torn.
    device.commitLocal(plain("e6", 2_006, "device-a", "第6条"));
    device.putLocalBlob("bookfile:b3", new Uint8Array(10));
    relay.shelf.set("bookfile:b1", new Uint8Array(7));

    device.adoptOtherAccount();
    expect(device.unverified.size).toBe(6);
    expect(device.unverifiedBlobs.size).toBe(3);

    const settled = await engine.verifyOnce();
    expect(settled).toBe(9);
    expect(relay.calls.have).toBe(1);
    expect(relay.calls.head).toBe(3);
    expect(device.unverified.size).toBe(0);
    expect(device.unverifiedBlobs.size).toBe(0);
    // Exactly e6 owes a push; b1 (size mismatch) and b3 (absent) owe an
    // upload; b2's staged parts add up and stay synced.
    expect(device.outbox.map((e) => e.id)).toEqual(["e6"]);
    expect([...device.blobOutbox].sort()).toEqual(["bookfile:b1", "bookfile:b3"]);
    expect(device.blobStates.get("bookfile:b2")).toBe("synced");
    for (let i = 1; i <= 5; i += 1) expect(device.remoteIds.get(`e${i}`)).toBe(i);

    await engine.pushOnce();
    expect(relay.count()).toBe(6);
  });

  test("a backend without have/HEAD settles pessimistically: everything unverified is pushed", async () => {
    const full = fakeRelay();
    const { haveEvents: _h, headBlob: _b, ...relay } = full;
    const device = fakeDevice();
    device.commitLocal(plain("e1", 2_001, "device-a", "一条"));
    device.putLocalBlob("bookfile:b1", new Uint8Array(4));
    const engine = engineFor(device, relay);
    await engine.pushOnce();
    await engine.syncBlobsOnce();
    device.adoptOtherAccount();
    await engine.verifyOnce();
    expect(device.outbox.map((e) => e.id)).toEqual(["e1"]);
    expect([...device.blobOutbox]).toEqual(["bookfile:b1"]);
    expect(full.calls.have + full.calls.head).toBe(0);
  });

  test("the cycle verifies before anything else moves", async () => {
    const relay = fakeRelay();
    const device = fakeDevice();
    device.commitLocal(plain("e1", 2_001, "device-a", "一条"));
    const engine = engineFor(device, relay);
    await engine.pushOnce();
    device.adoptOtherAccount();
    const phases: SyncCycleProgress["phase"][] = [];
    const seen = createSyncEngine({
      store: device.store,
      relay,
      masterKey: () => key,
      observe: () => {},
      onProgress: (p) => {
        if (phases[phases.length - 1] !== p.phase) phases.push(p.phase);
      },
      checkpointPublish: { minEvents: 1_000_000 },
    });
    const outcome = await seen.syncOnce();
    // (push reports only when a batch actually leaves — nothing did here.)
    expect(phases).toEqual(["verify", "pull", "blobs", "checkpoint"]);
    // Verify learned the relay holds e1; nothing was pushed again.
    expect(outcome.verified).toBe(1);
    expect(outcome.pushed).toBe(0);
    expect(relay.count()).toBe(1);
  });
});

describe("checkpoints: bootstrap from a snapshot, then backfill", () => {
  async function publisher(relay: ReturnType<typeof fakeRelay>, n = 7) {
    const device = fakeDevice();
    for (let i = 1; i <= n; i += 1) device.commitLocal(plain(`e${i}`, 2_000 + i, "device-p", `第${i}条`));
    const engine = engineFor(device, relay, undefined, {
      checkpointPublish: { minEvents: 1, retryMs: 0 },
    });
    // push, then a pull settles the cursor at the mailbox end → mailbox-exact.
    await engine.pushOnce();
    await engine.pullOnce();
    const cut = await engine.checkpointOnce();
    return { device, engine, cut };
  }

  test("publishing requires a mailbox-exact log and lands the blob + metadata", async () => {
    const relay = fakeRelay();
    const { device, cut } = await publisher(relay);
    expect(cut.published).toBe(true);
    const meta = relay.snapshots.get(1);
    expect(meta).toMatchObject({ frontierSeq: 7, schemaVersion: 1, deviceId: "device-fake" });
    expect(relay.shelf.has(meta!.blobKey)).toBe(true);
    expect(device.checkpoints.find((c) => c.origin === "publish")?.published).toBe(true);

    // Nothing new since: not due again.
    const again = await engineFor(device, relay, undefined, {
      checkpointPublish: { minEvents: 1, everyEvents: 5, retryMs: 0 },
    }).checkpointOnce();
    expect(again.published).toBe(false);
    // With unpushed local events the store refuses to cut — no lie is published.
    device.commitLocal(plain("e8", 2_008, "device-p", "第8条"));
    for (let i = 9; i <= 13; i += 1) device.commitLocal(plain(`e${i}`, 2_000 + i, "device-p", `第${i}条`));
    const refused = await engineFor(device, relay, undefined, {
      checkpointPublish: { minEvents: 1, everyEvents: 1, retryMs: 0 },
    }).checkpointOnce();
    expect(refused.published).toBe(false);
    expect(relay.snapshots.get(1)?.frontierSeq).toBe(7);
  });

  test("a fresh device restores the snapshot, syncs the tail, and backfills the log", async () => {
    const relay = fakeRelay();
    const { device: p, engine: pEngine } = await publisher(relay);
    // The tail: one more event after the snapshot was cut.
    p.commitLocal(plain("e8", 2_008, "device-p", "第8条"));
    await pEngine.pushOnce();

    const fresh = fakeDevice();
    const engine = engineFor(fresh, relay);
    const pullsBefore = relay.calls.pull;
    const outcome = await engine.syncOnce();
    expect(outcome.bootstrapped).toBe(true);
    // The shelf was complete after the restore; the tail came through the
    // ordinary pull; the clock observed the frontier.
    expect(fresh.applied.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"]);
    expect(fresh.observed.some((s) => s.wallMs === 2_007)).toBe(true);
    expect(fresh.cursorValue()).toBe(8);
    // Backfill: 5 pages × batch 2 covers the 7 pre-frontier events in one cycle.
    expect(outcome.backfillRemaining).toBe(0);
    expect(outcome.backfilled).toBe(7);
    expect(fresh.backfillState()?.complete).toBe(true);
    for (let i = 1; i <= 8; i += 1) expect(fresh.remoteIds.get(`e${i}`)).toBe(i);
    // The tail pull from the frontier + backfill pages: never the whole
    // mailbox through the merge path.
    expect(relay.calls.pull - pullsBefore).toBeLessThanOrEqual(6);
  });

  test("backfill is sliced per cycle and resumes from its cursor", async () => {
    const relay = fakeRelay();
    await publisher(relay, 9);
    const fresh = fakeDevice();
    const engine = engineFor(fresh, relay);
    expect(await engine.bootstrapOnce()).toBe("restored");
    const first = await engine.backfillOnce(2); // 2 pages × 2 = 4 events
    expect(first).toEqual({ appended: 4, remaining: 5 });
    const second = await engine.backfillOnce(2);
    expect(second).toEqual({ appended: 4, remaining: 1 });
    const third = await engine.backfillOnce(2);
    expect(third).toEqual({ appended: 1, remaining: 0 });
    expect(fresh.knownIds.size).toBe(9);
    expect(await engine.backfillOnce()).toEqual({ appended: 0, remaining: 0 });
  });

  test("unconfirmed local writes ride on top of the snapshot; confirmed history skips it", async () => {
    const relay = fakeRelay();
    await publisher(relay);
    // A fresh device that already changed a preference before connecting.
    const fresh = fakeDevice();
    fresh.commitLocal(plain("local-1", 9_000, "device-x", "本机新事件"));
    const outcome = await engineFor(fresh, relay).syncOnce();
    expect(outcome.bootstrapped).toBe(true);
    expect(fresh.applied.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4", "e5", "e6", "e7", "local-1"]);
    expect(relay.count()).toBe(8);
    expect(outcome.backfillRemaining).toBe(0);

    // A device whose log was confirmed by SOME mailbox replays instead.
    const veteran = fakeDevice();
    veteran.commitLocal(plain("old-1", 1_500, "device-y", "本机旧事件"));
    veteran.remoteIds.set("old-1", 3);
    veteran.outbox.length = 0;
    const engine = engineFor(veteran, relay);
    expect(await engine.bootstrapOnce()).toBe("skipped");
    const replayed = await engine.syncOnce();
    expect(replayed.bootstrapped).toBe(false);
    expect(replayed.pulled).toBe(8);
    expect(veteran.backfillState()).toBeNull();
  });

  test("a checkpoint upload the relay refuses for room does not fail the cycle", async () => {
    const relay = fakeRelay();
    const full: SyncRelayApi = {
      ...relay,
      async putBlob(key, bytes) {
        if (key.startsWith("snapshot:")) throw new RelayError(413, "account blob quota exceeded");
        return relay.putBlob(key, bytes);
      },
    };
    const device = fakeDevice();
    for (let i = 1; i <= 7; i += 1) device.commitLocal(plain(`e${i}`, 2_000 + i, "device-p", `第${i}条`));
    const engine = engineFor(device, full, undefined, {
      checkpointPublish: { minEvents: 1, retryMs: 0 },
    });
    await engine.pushOnce();
    await engine.pullOnce();
    // Refused, logged, and over — not thrown: the cycle that carries a
    // shelf's covers and events must not die on an optional upload.
    const cut = await engine.checkpointOnce();
    expect(cut.published).toBe(false);
    expect(relay.snapshots.size).toBe(0);
    expect(device.checkpoints.find((c) => c.origin === "publish")?.published).toBe(false);
    // A whole cycle over the same relay completes too.
    const outcome = await engine.syncOnce();
    expect(outcome.pushed).toBe(0);
    // A transient failure is still the cycle's to report.
    const flaky: SyncRelayApi = {
      ...relay,
      async putBlob(key, bytes) {
        if (key.startsWith("snapshot:")) throw new RelayError(503, "relay hiccup");
        return relay.putBlob(key, bytes);
      },
    };
    await expect(
      engineFor(device, flaky, undefined, { checkpointPublish: { minEvents: 1, retryMs: 0 } }).checkpointOnce(),
    ).rejects.toThrow("relay 503");
  });

  test("a publish that loses the race to a fresher snapshot deletes its redundant upload", async () => {
    const relay = fakeRelay();
    const { device } = await publisher(relay);
    device.commitLocal(plain("e8", 2_008, "device-p", "第8条"));
    // The race: our "is it due?" read sees a stale snapshot, but by the time
    // the PUT lands another device has published further ahead.
    relay.snapshots.set(1, {
      blobKey: "snapshot:v1:device-other:99",
      frontierSeq: 99,
      schemaVersion: 1,
      byteSize: 1,
      deviceId: "device-other",
      createdAt: "x",
    });
    const racy = {
      ...relay,
      latestSnapshot: async () => ({ ...relay.snapshots.get(1)!, frontierSeq: 0 }),
    };
    const e = engineFor(device, racy, undefined, {
      checkpointPublish: { minEvents: 1, everyEvents: 1, retryMs: 0 },
    });
    await e.pushOnce();
    await e.pullOnce();
    const attempt = await e.checkpointOnce();
    expect(attempt.published).toBe(false);
    const ours = device.checkpoints.filter((c) => c.origin === "publish").pop()!;
    expect(ours.published).toBe(false);
    expect(relay.shelf.has(ours.blobKey)).toBe(false);
    expect(relay.snapshots.get(1)?.frontierSeq).toBe(99);
  });
});


describe("a relay that predates the verification/snapshot endpoints", () => {
  test("404/405 answers degrade to the pessimistic path instead of failing the cycle", async () => {
    const full = fakeRelay();
    const older: SyncRelayApi = {
      ...full,
      async haveEvents() {
        throw Object.assign(new Error("relay 404: no such route"), { status: 404 });
      },
      async headBlob() {
        throw Object.assign(new Error("relay 405: method not allowed"), { status: 405 });
      },
      async latestSnapshot() {
        throw Object.assign(new Error("relay 404: no such route"), { status: 404 });
      },
    };
    const device = fakeDevice();
    device.commitLocal(plain("e1", 2_001, "device-a", "一条"));
    device.putLocalBlob("bookfile:b1", new Uint8Array(4));
    const engine = engineFor(device, older, undefined, { checkpointPublish: { minEvents: 1, retryMs: 0 } });
    await engine.pushOnce();
    await engine.syncBlobsOnce();
    device.adoptOtherAccount();
    const outcome = await engine.syncOnce();
    // Everything unverified was assumed missing and pushed again (the relay
    // dedups by id), the blob re-uploaded, no bootstrap, no publish, no error.
    expect(outcome.verified).toBe(2);
    expect(outcome.bootstrapped).toBe(false);
    expect(device.unverified.size + device.unverifiedBlobs.size).toBe(0);
    expect(full.count()).toBe(1);
    expect(full.snapshots.size).toBe(0);
  });
});


describe("checkpoint publish pacing", () => {
  test("a cycle that pushed does not publish; the next pull-only cycle does", async () => {
    const relay = fakeRelay();
    const device = fakeDevice();
    for (let i = 1; i <= 3; i += 1) device.commitLocal(plain(`e${i}`, 2_000 + i, "device-a", `第${i}条`));
    const engine = engineFor(device, relay, undefined, { checkpointPublish: { minEvents: 1, retryMs: 60_000 } });
    const first = await engine.syncOnce();
    expect(first.pushed).toBe(3);
    expect(relay.snapshots.size).toBe(0);
    // Nothing to push now: the pull settles the cursor and the publish lands,
    // even though the retry window has not elapsed (no attempt was made).
    const second = await engine.syncOnce();
    expect(second.pushed).toBe(0);
    expect(relay.snapshots.get(1)?.frontierSeq).toBe(3);
  });
});
