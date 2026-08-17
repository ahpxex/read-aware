import { describe, expect, test } from "bun:test";
import { del, get, login, makeRelay, post, putBytes, sealed } from "./harness";

const KEYS = {
  kdfSalt: "c2FsdA==",
  kdfParams: { algo: "argon2id", t: 2, m: 19456, p: 1 },
  keyCheck: "v1:Y2hlY2s=",
};

describe("magic-link auth", () => {
  test("request → verify issues a working session; first login has no keys", async () => {
    const { handle } = makeRelay();
    const { session, accountId, keys } = await login(handle, "reader@example.com");
    expect(session.length).toBeGreaterThan(20);
    expect(keys).toBeNull();
    const account = await handle(get("/v1/account", session));
    expect(account.status).toBe(200);
    expect(await account.json()).toMatchObject({ accountId, email: "reader@example.com" });
  });

  test("a magic token is single-use", async () => {
    const { handle } = makeRelay();
    const requested = await handle(post("/v1/auth/request", { email: "reader@example.com" }));
    const { devToken } = (await requested.json()) as { devToken: string };
    expect((await handle(post("/v1/auth/verify", { token: devToken }))).status).toBe(200);
    expect((await handle(post("/v1/auth/verify", { token: devToken }))).status).toBe(401);
  });

  test("an expired token is refused", async () => {
    const { handle, advance } = makeRelay();
    const requested = await handle(post("/v1/auth/request", { email: "reader@example.com" }));
    const { devToken } = (await requested.json()) as { devToken: string };
    advance(16 * 60 * 1000);
    expect((await handle(post("/v1/auth/verify", { token: devToken }))).status).toBe(401);
  });

  test("email case/whitespace variants land on one account", async () => {
    const { handle } = makeRelay();
    const first = await login(handle, "Reader@Example.com");
    const second = await login(handle, "  reader@example.com  ".trim());
    expect(second.accountId).toBe(first.accountId);
  });

  test("garbage tokens, bad emails, and missing sessions are rejected", async () => {
    const { handle } = makeRelay();
    expect((await handle(post("/v1/auth/request", { email: "not-an-email" }))).status).toBe(400);
    expect((await handle(post("/v1/auth/verify", { token: "nope" }))).status).toBe(401);
    expect((await handle(get("/v1/events?after=0"))).status).toBe(401);
    expect((await handle(get("/v1/events?after=0", "stolen-token"))).status).toBe(401);
  });

  test("logout revokes the session", async () => {
    const { handle } = makeRelay();
    const { session } = await login(handle, "reader@example.com");
    expect((await handle(post("/v1/auth/logout", {}, session))).status).toBe(204);
    expect((await handle(get("/v1/account", session))).status).toBe(401);
  });
});

describe("key material", () => {
  test("publishes once, then serves every later device", async () => {
    const { handle } = makeRelay();
    const first = await login(handle, "reader@example.com");
    expect((await handle(post("/v1/account/keys", KEYS, first.session))).status).toBe(200);
    const second = await login(handle, "reader@example.com");
    expect(second.keys).toMatchObject({ kdfSalt: KEYS.kdfSalt, keyCheck: KEYS.keyCheck });
  });

  test("a second publish is refused with the canonical material", async () => {
    const { handle } = makeRelay();
    const { session } = await login(handle, "reader@example.com");
    await handle(post("/v1/account/keys", KEYS, session));
    const conflict = await handle(
      post("/v1/account/keys", { ...KEYS, keyCheck: "v1:b3RoZXI=" }, session),
    );
    expect(conflict.status).toBe(409);
    const body = (await conflict.json()) as { keys: { keyCheck: string } };
    expect(body.keys.keyCheck).toBe(KEYS.keyCheck);
  });

  test("malformed key material is rejected", async () => {
    const { handle } = makeRelay();
    const { session } = await login(handle, "reader@example.com");
    const res = await handle(
      post("/v1/account/keys", { kdfSalt: "x", kdfParams: { algo: "md5" }, keyCheck: "y" }, session),
    );
    expect(res.status).toBe(400);
  });
});

describe("the numbered mailbox", () => {
  test("push assigns dense seqs; redelivery returns the same numbers", async () => {
    const { handle } = makeRelay();
    const { session } = await login(handle, "reader@example.com");
    const batch = [sealed("e1"), sealed("e2"), sealed("e3")];
    const first = await handle(post("/v1/events", { events: batch }, session));
    const { seqs } = (await first.json()) as { seqs: Record<string, number> };
    expect(Object.values(seqs).sort()).toEqual([1, 2, 3]);

    // A crashed client re-pushes the same batch plus one new event.
    const second = await handle(
      post("/v1/events", { events: [...batch, sealed("e4")] }, session),
    );
    const again = ((await second.json()) as { seqs: Record<string, number> }).seqs;
    expect(again.e1).toBe(seqs.e1);
    expect(again.e3).toBe(seqs.e3);
    expect(again.e4).toBe(4);
  });

  test("pull pages in seq order and reports a stable cursor", async () => {
    const { handle } = makeRelay();
    const { session } = await login(handle, "reader@example.com");
    await handle(
      post("/v1/events", { events: [sealed("e1"), sealed("e2"), sealed("e3")] }, session),
    );

    const page1 = await handle(get("/v1/events?after=0&limit=2", session));
    const body1 = (await page1.json()) as { events: { id: string }[]; next: number };
    expect(body1.events.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(body1.next).toBe(2);

    const page2 = await handle(get(`/v1/events?after=${body1.next}&limit=2`, session));
    const body2 = (await page2.json()) as { events: { id: string }[]; next: number };
    expect(body2.events.map((e) => e.id)).toEqual(["e3"]);
    // Drained: shorter than the limit, and the cursor holds still on re-poll.
    const page3 = await handle(get(`/v1/events?after=${body2.next}&limit=2`, session));
    const body3 = (await page3.json()) as { events: unknown[]; next: number };
    expect(body3.events).toEqual([]);
    expect(body3.next).toBe(body2.next);
  });

  test("the envelope crosses the relay byte-identical", async () => {
    const { handle } = makeRelay();
    const { session } = await login(handle, "reader@example.com");
    const envelope = sealed("roundtrip");
    await handle(post("/v1/events", { events: [envelope] }, session));
    const page = await handle(get("/v1/events?after=0", session));
    const { events } = (await page.json()) as { events: unknown[] };
    expect(events[0]).toEqual(envelope);
  });

  test("two accounts never see each other's events", async () => {
    const { handle } = makeRelay();
    const a = await login(handle, "a@example.com");
    const b = await login(handle, "b@example.com");
    await handle(post("/v1/events", { events: [sealed("a-secret")] }, a.session));
    const page = await handle(get("/v1/events?after=0", b.session));
    const { events } = (await page.json()) as { events: unknown[] };
    expect(events).toEqual([]);
  });

  test("shape and size limits hold the door", async () => {
    const { handle } = makeRelay({ maxEventBytes: 200, maxBatch: 2 });
    const { session } = await login(handle, "reader@example.com");
    const malformed = await handle(
      post("/v1/events", { events: [{ id: "x", v: 2 }] }, session),
    );
    expect(malformed.status).toBe(400);
    const oversized = await handle(
      post("/v1/events", { events: [{ ...sealed("big"), ciphertext: "x".repeat(400) }] }, session),
    );
    expect(oversized.status).toBe(413);
    const flood = await handle(
      post("/v1/events", { events: [sealed(), sealed(), sealed()] }, session),
    );
    expect(flood.status).toBe(413);
  });
});

describe("blobs", () => {
  const bytes = new TextEncoder().encode("sealed book bytes");

  test("put/get/delete round trip with quota accounting", async () => {
    const { handle } = makeRelay();
    const { session } = await login(handle, "reader@example.com");
    const put = await handle(putBytes("/v1/blobs/bookfile%3Ab1", bytes, session));
    expect(put.status).toBe(200);
    expect(((await put.json()) as { bytesUsed: number }).bytesUsed).toBe(bytes.length);

    const got = await handle(get("/v1/blobs/bookfile%3Ab1", session));
    expect([...new Uint8Array(await got.arrayBuffer())]).toEqual([...bytes]);

    expect((await handle(del("/v1/blobs/bookfile%3Ab1", session))).status).toBe(204);
    expect((await handle(get("/v1/blobs/bookfile%3Ab1", session))).status).toBe(404);
    const account = await handle(get("/v1/account", session));
    expect(((await account.json()) as { blobBytesUsed: number }).blobBytesUsed).toBe(0);
  });

  test("replacing a key does not double-count quota", async () => {
    const { handle } = makeRelay();
    const { session } = await login(handle, "reader@example.com");
    await handle(putBytes("/v1/blobs/bookfile%3Ab1", bytes, session));
    const bigger = new Uint8Array(bytes.length + 5).fill(7);
    await handle(putBytes("/v1/blobs/bookfile%3Ab1", bigger, session));
    const account = await handle(get("/v1/account", session));
    expect(((await account.json()) as { blobBytesUsed: number }).blobBytesUsed).toBe(bigger.length);
  });

  test("the account quota refuses what would overflow it", async () => {
    const { handle } = makeRelay({ maxAccountBlobBytes: 20 });
    const { session } = await login(handle, "reader@example.com");
    expect(
      (await handle(putBytes("/v1/blobs/bookfile%3Ab1", new Uint8Array(15), session))).status,
    ).toBe(200);
    const refused = await handle(putBytes("/v1/blobs/bookfile%3Ab2", new Uint8Array(15), session));
    expect(refused.status).toBe(413);
    // The refused upload must not have charged the account.
    const account = await handle(get("/v1/account", session));
    expect(((await account.json()) as { blobBytesUsed: number }).blobBytesUsed).toBe(15);
  });

  test("accounts are isolated even under the same blob key", async () => {
    const { handle } = makeRelay();
    const a = await login(handle, "a@example.com");
    const b = await login(handle, "b@example.com");
    await handle(putBytes("/v1/blobs/bookfile%3Ab1", bytes, a.session));
    expect((await handle(get("/v1/blobs/bookfile%3Ab1", b.session))).status).toBe(404);
  });
});

describe("account deletion", () => {
  test("wipes mailbox, blobs, and sessions; a fresh login starts clean", async () => {
    const { handle } = makeRelay();
    const first = await login(handle, "reader@example.com");
    await handle(post("/v1/account/keys", KEYS, first.session));
    await handle(post("/v1/events", { events: [sealed("e1")] }, first.session));
    await handle(putBytes("/v1/blobs/bookfile%3Ab1", new Uint8Array(8), first.session));

    expect((await handle(del("/v1/account", first.session))).status).toBe(204);
    expect((await handle(get("/v1/account", first.session))).status).toBe(401);

    const rejoined = await login(handle, "reader@example.com");
    expect(rejoined.accountId).not.toBe(first.accountId);
    expect(rejoined.keys).toBeNull();
    const page = await handle(get("/v1/events?after=0", rejoined.session));
    expect(((await page.json()) as { events: unknown[] }).events).toEqual([]);
  });
});

describe("cors", () => {
  test("preflight succeeds and every response carries the allow-origin header", async () => {
    const { handle } = makeRelay();
    const preflight = await handle(
      new Request("https://relay.test/v1/events", { method: "OPTIONS" }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("authorization");

    const { session } = await login(handle, "reader@example.com");
    const ok = await handle(get("/v1/account", session));
    expect(ok.headers.get("access-control-allow-origin")).toBe("*");
    const denied = await handle(get("/v1/account"));
    expect(denied.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("the event quota (the operator's bill guard)", () => {
  test("refuses atomically at the cap, while redelivery of known events still succeeds", async () => {
    const { handle } = makeRelay({ maxAccountEvents: 2 });
    const { session } = await login(handle, "reader@example.com");
    const batch = [sealed("e1"), sealed("e2")];
    expect((await handle(post("/v1/events", { events: batch }, session))).status).toBe(200);

    // The cap is reached: one more NEW event is refused...
    const refused = await handle(post("/v1/events", { events: [sealed("e3")] }, session));
    expect(refused.status).toBe(413);
    // ...atomically — a mixed batch appends nothing, not half.
    const mixed = await handle(
      post("/v1/events", { events: [sealed("e4"), sealed("e5")] }, session),
    );
    expect(mixed.status).toBe(413);
    const page = await handle(get("/v1/events?after=0", session));
    const { events } = (await page.json()) as { events: { id: string }[] };
    expect(events.map((e) => e.id)).toEqual(["e1", "e2"]);

    // A crashed client re-pushing what the relay already holds is NOT new
    // usage and must not be locked out of its acknowledgements.
    const redelivered = await handle(post("/v1/events", { events: batch }, session));
    expect(redelivered.status).toBe(200);
  });
});

describe("diagnostic reports", () => {
  const bundle = { logs: [{ name: "readaware.log", text: "boot start" }] };
  const report = (extra: Record<string, unknown> = {}, ip?: string) =>
    new Request("https://relay.test/v1/report", {
      method: "POST",
      body: JSON.stringify({ appVersion: "0.3.0", platform: "macos", bundle, ...extra }),
      headers: ip ? { "cf-connecting-ip": ip } : {},
    });

  test("a valid report is stored: payload bytes + a receipt id", async () => {
    const { handle, reportPayloads } = makeRelay();
    const response = await handle(report());
    expect(response.status).toBe(200);
    const { reportId } = (await response.json()) as { reportId: string };
    expect(reportId.length).toBeGreaterThan(10);
    const stored = reportPayloads.get(reportId);
    expect(stored).toBeDefined();
    expect(JSON.parse(new TextDecoder().decode(stored))).toMatchObject({
      appVersion: "0.3.0",
      platform: "macos",
    });
  });

  test("malformed reports are refused", async () => {
    const { handle } = makeRelay();
    expect((await handle(report({ appVersion: undefined }))).status).toBe(400);
    expect((await handle(report({ platform: 42 }))).status).toBe(400);
    expect((await handle(report({ bundle: "not an object" }))).status).toBe(400);
    const notJson = new Request("https://relay.test/v1/report", { method: "POST", body: "{" });
    expect((await handle(notJson)).status).toBe(400);
  });

  test("an oversized report is refused before parsing", async () => {
    const { handle } = makeRelay({ maxReportBytes: 200 });
    expect((await handle(report({ bundle: { pad: "x".repeat(400) } }))).status).toBe(413);
  });

  test("per-IP throttle: the day cap refuses, a new day and another IP do not", async () => {
    const { handle, advance } = makeRelay({ maxReportsPerIpPerDay: 2 });
    expect((await handle(report({}, "203.0.113.9"))).status).toBe(200);
    expect((await handle(report({}, "203.0.113.9"))).status).toBe(200);
    expect((await handle(report({}, "203.0.113.9"))).status).toBe(429);
    expect((await handle(report({}, "203.0.113.10"))).status).toBe(200);
    advance(24 * 60 * 60 * 1000 + 1);
    expect((await handle(report({}, "203.0.113.9"))).status).toBe(200);
  });
});
