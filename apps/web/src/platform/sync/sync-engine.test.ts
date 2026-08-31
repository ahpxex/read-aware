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
