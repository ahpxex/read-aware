/**
 * Account tiers: the tier decides quotas and nothing else. These tests pin
 * the whole surface — the admin write seam, per-tier enforcement on both
 * write paths (events + blobs), expiry falling back to free, and the
 * /v1/account report the client renders its usage line from.
 */
import { describe, expect, test } from "bun:test";
import type { AccountResponse } from "@read-aware/core";
import { get, login, makeRelay, post, putBytes, sealed } from "./harness";

const ADMIN = "admin-secret-token";

/** POST /v1/admin/tier with the operator bearer (reuses post()'s session slot). */
const setTier = (
  handle: (req: Request) => Promise<Response>,
  body: unknown,
  token: string = ADMIN,
) => handle(post("/v1/admin/tier", body, token));

const accountOf = async (
  handle: (req: Request) => Promise<Response>,
  session: string,
): Promise<AccountResponse> =>
  (await (await handle(get("/v1/account", session))).json()) as AccountResponse;

describe("the admin tier seam", () => {
  test("answers 501 until an admin token is configured", async () => {
    const { handle } = makeRelay();
    const res = await setTier(handle, { email: "a@example.com", tier: "pro" });
    expect(res.status).toBe(501);
  });

  test("refuses a wrong or missing bearer", async () => {
    const { handle } = makeRelay({ adminToken: ADMIN });
    await login(handle, "reader@example.com");
    const wrong = await setTier(handle, { email: "reader@example.com", tier: "pro" }, "guess");
    expect(wrong.status).toBe(401);
    const missing = await handle(
      new Request("https://relay.test/v1/admin/tier", {
        method: "POST",
        body: JSON.stringify({ email: "reader@example.com", tier: "pro" }),
      }),
    );
    expect(missing.status).toBe(401);
  });

  test("validates tier, email shape, and expiry; 404s an unknown account", async () => {
    const { handle } = makeRelay({ adminToken: ADMIN });
    await login(handle, "reader@example.com");
    expect((await setTier(handle, { email: "reader@example.com", tier: "gold" })).status).toBe(400);
    expect((await setTier(handle, { email: "not-an-email", tier: "pro" })).status).toBe(400);
    expect(
      (await setTier(handle, { email: "reader@example.com", tier: "pro", expiresAtMs: "soon" }))
        .status,
    ).toBe(400);
    expect((await setTier(handle, { email: "ghost@example.com", tier: "pro" })).status).toBe(404);
  });

  test("assigns a tier (email case-insensitively) and reports it back", async () => {
    const { handle } = makeRelay({ adminToken: ADMIN });
    const { session } = await login(handle, "reader@example.com");
    const res = await setTier(handle, { email: "Reader@Example.com", tier: "pro" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tier: "pro", tierExpiresAtMs: null });
    expect((await accountOf(handle, session)).tier).toBe("pro");
  });
});

describe("what /v1/account reports", () => {
  test("a fresh account is free with the config baseline and zeroed usage", async () => {
    const { handle } = makeRelay({ maxAccountBlobBytes: 1000, maxAccountEvents: 7 });
    const { session } = await login(handle, "reader@example.com");
    const account = await accountOf(handle, session);
    expect(account.tier).toBe("free");
    expect(account.limits).toEqual({
      maxBlobBytes: 50 * 1024 * 1024,
      maxAccountBlobBytes: 1000,
      maxAccountEvents: 7,
      aiMonthlyCredits: 0,
    });
    expect(account.eventsUsed).toBe(0);
    expect(account.blobBytesUsed).toBe(0);
  });

  test("eventsUsed counts stored events, not redeliveries", async () => {
    const { handle } = makeRelay();
    const { session } = await login(handle, "reader@example.com");
    const twice = sealed("evt-repeat");
    await handle(post("/v1/events", { events: [twice, sealed()] }, session));
    await handle(post("/v1/events", { events: [twice] }, session));
    expect((await accountOf(handle, session)).eventsUsed).toBe(2);
  });

  test("staff limits read as unlimited (null) on the wire", async () => {
    const { handle } = makeRelay({ adminToken: ADMIN });
    const { session } = await login(handle, "reader@example.com");
    await setTier(handle, { email: "reader@example.com", tier: "staff" });
    const account = await accountOf(handle, session);
    expect(account.limits.maxAccountBlobBytes).toBeNull();
    expect(account.limits.maxAccountEvents).toBeNull();
  });
});

describe("per-tier enforcement", () => {
  test("an upgrade lifts both the account blob quota and the per-file cap", async () => {
    const { handle } = makeRelay({ adminToken: ADMIN, maxBlobBytes: 10, maxAccountBlobBytes: 20 });
    const { session } = await login(handle, "reader@example.com");
    // Free: the 25-byte file breaks the per-file cap, two 10s break the total.
    expect((await handle(putBytes("/v1/blobs/b%3A1", new Uint8Array(25), session))).status).toBe(413);
    await handle(putBytes("/v1/blobs/b%3A2", new Uint8Array(10), session));
    expect((await handle(putBytes("/v1/blobs/b%3A3", new Uint8Array(15), session))).status).toBe(413);

    await setTier(handle, { email: "reader@example.com", tier: "pro" });
    expect((await handle(putBytes("/v1/blobs/b%3A1", new Uint8Array(25), session))).status).toBe(200);
    expect((await handle(putBytes("/v1/blobs/b%3A3", new Uint8Array(15), session))).status).toBe(200);
  });

  test("an upgrade lifts the event quota; staff is unmetered", async () => {
    const { handle } = makeRelay({ adminToken: ADMIN, maxAccountEvents: 2 });
    const { session } = await login(handle, "reader@example.com");
    await handle(post("/v1/events", { events: [sealed(), sealed()] }, session));
    expect(
      (await handle(post("/v1/events", { events: [sealed()] }, session))).status,
    ).toBe(413);

    await setTier(handle, { email: "reader@example.com", tier: "pro" });
    expect((await handle(post("/v1/events", { events: [sealed()] }, session))).status).toBe(200);

    await setTier(handle, { email: "reader@example.com", tier: "staff" });
    expect(
      (await handle(post("/v1/events", { events: [sealed(), sealed(), sealed()] }, session)))
        .status,
    ).toBe(200);
  });

  test("an expired paid tier reads and enforces as free, but pulls still work", async () => {
    const { handle, advance } = makeRelay({ adminToken: ADMIN, maxAccountEvents: 2 });
    const { session } = await login(handle, "reader@example.com");
    const day = 24 * 60 * 60 * 1000;
    await setTier(handle, {
      email: "reader@example.com",
      tier: "pro",
      expiresAtMs: 1_755_000_000_000 + day,
    });
    await handle(post("/v1/events", { events: [sealed(), sealed(), sealed()] }, session));
    expect((await accountOf(handle, session)).tier).toBe("pro");

    advance(2 * day);
    const account = await accountOf(handle, session);
    expect(account.tier).toBe("free");
    expect(account.limits.maxAccountEvents).toBe(2);
    // Already over the free quota: new pushes refuse, the existing log pulls.
    expect((await handle(post("/v1/events", { events: [sealed()] }, session))).status).toBe(413);
    const pulled = await handle(get("/v1/events?after=0&limit=10", session));
    expect(pulled.status).toBe(200);
    expect(((await pulled.json()) as { events: unknown[] }).events).toHaveLength(3);
  });
});
