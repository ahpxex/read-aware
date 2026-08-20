/**
 * Billing: checkout session shaping (signed-in vs web), the webhook as the
 * paying users' tier write path, and the signature fence. The Stripe API is
 * a fake injected through ports.stripe.fetch; webhook signatures are REAL
 * HMACs so the verification code path is exercised, not stubbed.
 */
import { describe, expect, test } from "bun:test";
import type { AccountResponse } from "@read-aware/core";
import type { RelayPorts } from "../src/ports";
import { get, login, makeRelay, post } from "./harness";

const WHSEC = "whsec_test_secret";
const BASE_NOW = 1_755_000_000_000;

type Handle = (req: Request) => Promise<Response>;

/** A fake api.stripe.com; records every call's path and form body. */
function fakeStripe(options: { activeSubs?: number } = {}) {
  const calls: { url: string; form: URLSearchParams | null }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const form = init?.body ? new URLSearchParams(String(init.body)) : null;
    calls.push({ url, form });
    if (url.includes("/v1/prices")) {
      const lookup = new URL(url).searchParams.get("lookup_keys[]");
      return Response.json({ data: [{ id: `price_fake_${lookup}` }] });
    }
    if (url.includes("/v1/subscriptions")) {
      return Response.json({ data: Array(options.activeSubs ?? 0).fill({ id: "sub_1" }) });
    }
    if (url.includes("/v1/checkout/sessions")) {
      return Response.json({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" });
    }
    if (url.includes("/v1/billing_portal/sessions")) {
      return Response.json({ id: "bps_1", url: "https://billing.stripe.com/p/session/1" });
    }
    return Response.json({ error: { message: `unexpected ${url}` } }, { status: 400 });
  }) as typeof fetch;
  return { fetchFn, calls };
}

function relayWithStripe(options: { activeSubs?: number } = {}) {
  const stripe = fakeStripe(options);
  const ports: RelayPorts["stripe"] = {
    secretKey: "sk_test_fake",
    webhookSecret: WHSEC,
    fetch: stripe.fetchFn,
  };
  // relayOrigin is CONFIG, never req.url — wrangler dev rewrites the request
  // host to the production route domain, which is exactly the bug this guards.
  return { ...makeRelay({ relayOrigin: "https://relay.test" }, {}, {}, ports), stripe };
}

const encoder = new TextEncoder();

/** Stripe's signing scheme, reproduced for the tests: HMAC over `t.payload`. */
async function signedHeader(payload: string, nowMs: number, secret = WHSEC): Promise<string> {
  const t = Math.floor(nowMs / 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${t}.${payload}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${hex}`;
}

async function webhook(handle: Handle, event: unknown, nowMs = BASE_NOW, secret = WHSEC) {
  const payload = JSON.stringify(event);
  return handle(
    new Request("https://relay.test/v1/billing/webhook", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": await signedHeader(payload, nowMs, secret) },
    }),
  );
}

const accountOf = async (handle: Handle, session: string): Promise<AccountResponse> =>
  (await (await handle(get("/v1/account", session))).json()) as AccountResponse;

describe("checkout", () => {
  test("answers 501 when billing is not configured", async () => {
    const { handle } = makeRelay();
    expect((await handle(post("/v1/billing/checkout", { plan: "pro" }))).status).toBe(501);
  });

  test("web checkout: no account bound, Stripe collects the email", async () => {
    const { handle, stripe } = relayWithStripe();
    const res = await handle(post("/v1/billing/checkout", { plan: "pro", locale: "zh" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url: string }).url).toContain("checkout.stripe.com");

    const created = stripe.calls.find((c) => c.url.includes("/v1/checkout/sessions"))!;
    expect(created.form?.get("line_items[0][price]")).toBe("price_fake_pro_monthly");
    expect(created.form?.get("metadata[tier]")).toBe("pro");
    expect(created.form?.get("customer_email")).toBeNull();
    expect(created.form?.get("client_reference_id")).toBeNull();
    // The locale rides into the return URLs.
    expect(created.form?.get("success_url")).toBe("https://readaware.app/zh/pricing?purchase=success");
  });

  test("signed-in checkout binds the account and locks the email", async () => {
    const { handle, stripe } = relayWithStripe();
    const { session, accountId } = await login(handle, "reader@example.com");
    const res = await handle(post("/v1/billing/checkout", { plan: "sync" }, session));
    expect(res.status).toBe(200);
    const created = stripe.calls.find((c) => c.url.includes("/v1/checkout/sessions"))!;
    expect(created.form?.get("customer_email")).toBe("reader@example.com");
    expect(created.form?.get("client_reference_id")).toBe(accountId);
  });

  test("an already-subscribed account is sent to the portal instead", async () => {
    const { handle } = relayWithStripe({ activeSubs: 1 });
    const { session, accountId } = await login(handle, "reader@example.com");
    // Link a customer the way the webhook would.
    await webhook(handle, {
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          client_reference_id: accountId,
          customer: "cus_1",
          metadata: { tier: "pro" },
        },
      },
    });
    expect((await handle(post("/v1/billing/checkout", { plan: "max" }, session))).status).toBe(409);
  });

  test("refuses an unknown plan", async () => {
    const { handle } = relayWithStripe();
    expect((await handle(post("/v1/billing/checkout", { plan: "staff" }))).status).toBe(400);
  });

  test("minting a billing ticket requires a session", async () => {
    const { handle } = relayWithStripe();
    expect((await handle(post("/v1/billing/ticket", {}))).status).toBe(401);
  });

  test("ticketed checkout binds the account and returns the buyer to the app", async () => {
    const { handle, stripe } = relayWithStripe();
    const { session, accountId } = await login(handle, "reader@example.com");
    const minted = await handle(post("/v1/billing/ticket", {}, session));
    expect(minted.status).toBe(200);
    const { ticket } = (await minted.json()) as { ticket: string };

    // No Authorization header — the ticket alone carries the binding.
    const res = await handle(post("/v1/billing/checkout", { plan: "pro", locale: "zh", ticket }));
    expect(res.status).toBe(200);
    const created = stripe.calls.find((c) => c.url.includes("/v1/checkout/sessions"))!;
    expect(created.form?.get("client_reference_id")).toBe(accountId);
    expect(created.form?.get("customer_email")).toBe("reader@example.com");
    expect(created.form?.get("success_url")).toBe(
      "https://relay.test/v1/billing/return?lang=zh-Hans",
    );
    // A cancel keeps the ticket in the URL, so the retry stays bound.
    expect(created.form?.get("cancel_url")).toContain(`#upgrade=${ticket}`);
  });

  test("a billing ticket survives a first redemption (cancel-then-retry)", async () => {
    const { handle, stripe } = relayWithStripe();
    const { session } = await login(handle, "reader@example.com");
    const { ticket } = (await (
      await handle(post("/v1/billing/ticket", {}, session))
    ).json()) as { ticket: string };
    expect((await handle(post("/v1/billing/checkout", { plan: "pro", ticket }))).status).toBe(200);
    expect((await handle(post("/v1/billing/checkout", { plan: "pro", ticket }))).status).toBe(200);
    const bound = stripe.calls.filter(
      (c) => c.url.includes("/v1/checkout/sessions") && c.form?.get("client_reference_id"),
    );
    expect(bound.length).toBe(2);
  });

  test("a bogus ticket is refused, not downgraded to a web checkout", async () => {
    const { handle } = relayWithStripe();
    const res = await handle(post("/v1/billing/checkout", { plan: "pro", ticket: "forged" }));
    expect(res.status).toBe(401);
  });

  test("the billing return page carries the deep link", async () => {
    const { handle } = relayWithStripe();
    const res = await handle(get("/v1/billing/return?lang=ja"));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("readaware://billing/success");
    expect(html).toContain('lang="ja"');
  });
});

describe("the webhook fence", () => {
  test("a wrong secret and a stale timestamp are both refused", async () => {
    const { handle } = relayWithStripe();
    const event = { type: "checkout.session.completed", data: { object: {} } };
    expect((await webhook(handle, event, BASE_NOW, "whsec_wrong")).status).toBe(400);
    expect((await webhook(handle, event, BASE_NOW - 10 * 60 * 1000)).status).toBe(400);
    expect((await webhook(handle, event)).status).toBe(200);
  });

  test("an unsigned request is refused", async () => {
    const { handle } = relayWithStripe();
    const res = await handle(
      new Request("https://relay.test/v1/billing/webhook", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("fulfillment", () => {
  const completed = (accountId: string | null, email: string | null, tier = "pro") => ({
    type: "checkout.session.completed",
    data: {
      object: {
        mode: "subscription",
        client_reference_id: accountId,
        customer: "cus_1",
        customer_details: email ? { email } : undefined,
        metadata: { tier },
      },
    },
  });

  test("signed-in purchase upgrades the account and links the customer", async () => {
    const { handle } = relayWithStripe();
    const { session, accountId } = await login(handle, "reader@example.com");
    expect((await webhook(handle, completed(accountId, null))).status).toBe(200);
    const account = await accountOf(handle, session);
    expect(account.tier).toBe("pro");
    expect(account.hasBilling).toBe(true);
  });

  test("web purchase fulfills by email — the later sign-in lands upgraded", async () => {
    const { handle } = relayWithStripe();
    await webhook(handle, completed(null, "Buyer@Example.com", "max"));
    // The buyer signs in afterwards with the same address.
    const { session } = await login(handle, "buyer@example.com");
    expect((await accountOf(handle, session)).tier).toBe("max");
  });

  const subscriptionEvent = (
    type: "customer.subscription.updated" | "customer.subscription.deleted",
    overrides: Record<string, unknown> = {},
  ) => ({
    type,
    data: {
      object: {
        customer: "cus_1",
        status: "active",
        cancel_at_period_end: false,
        items: { data: [{ price: { lookup_key: "pro_monthly", metadata: { tier: "pro" } } }] },
        ...overrides,
      },
    },
  });

  async function paidAccount(handle: Handle) {
    const { session, accountId } = await login(handle, "reader@example.com");
    await webhook(handle, completed(accountId, null));
    return { session, accountId };
  }

  test("a portal plan change re-tiers from the subscription price", async () => {
    const { handle } = relayWithStripe();
    const { session } = await paidAccount(handle);
    await webhook(
      handle,
      subscriptionEvent("customer.subscription.updated", {
        items: { data: [{ price: { lookup_key: "max_monthly", metadata: { tier: "max" } } }] },
      }),
    );
    expect((await accountOf(handle, session)).tier).toBe("max");
  });

  test("cancel-at-period-end keeps the tier until the period turns", async () => {
    const { handle, advance } = relayWithStripe();
    const { session } = await paidAccount(handle);
    const periodEnd = Math.floor(BASE_NOW / 1000) + 7 * 24 * 60 * 60;
    await webhook(
      handle,
      subscriptionEvent("customer.subscription.updated", {
        cancel_at_period_end: true,
        // The newer API shape: period end lives on the subscription item.
        items: {
          data: [
            {
              current_period_end: periodEnd,
              price: { lookup_key: "pro_monthly", metadata: { tier: "pro" } },
            },
          ],
        },
      }),
    );
    expect((await accountOf(handle, session)).tier).toBe("pro");
    advance(8 * 24 * 60 * 60 * 1000);
    expect((await accountOf(handle, session)).tier).toBe("free");
  });

  test("subscription deletion drops the account to free; data quotas follow", async () => {
    const { handle } = relayWithStripe();
    const { session } = await paidAccount(handle);
    await webhook(handle, subscriptionEvent("customer.subscription.deleted"));
    const account = await accountOf(handle, session);
    expect(account.tier).toBe("free");
    expect(account.hasBilling).toBe(true); // the customer link survives for re-subscribing
  });

  test("past_due is grace, not a downgrade", async () => {
    const { handle } = relayWithStripe();
    const { session } = await paidAccount(handle);
    await webhook(handle, subscriptionEvent("customer.subscription.updated", { status: "past_due" }));
    expect((await accountOf(handle, session)).tier).toBe("pro");
  });

  test("events for customers we never linked are acknowledged and ignored", async () => {
    const { handle } = relayWithStripe();
    const res = await webhook(
      handle,
      subscriptionEvent("customer.subscription.updated", { customer: "cus_stranger" }),
    );
    expect(res.status).toBe(200);
  });
});

describe("the portal", () => {
  test("requires a linked billing profile", async () => {
    const { handle } = relayWithStripe();
    const { session } = await login(handle, "reader@example.com");
    expect((await handle(post("/v1/billing/portal", {}, session))).status).toBe(404);
  });

  test("hands back the hosted portal URL for a paying account", async () => {
    const { handle } = relayWithStripe();
    const { session, accountId } = await login(handle, "reader@example.com");
    await webhook(handle, {
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          client_reference_id: accountId,
          customer: "cus_1",
          metadata: { tier: "pro" },
        },
      },
    });
    const res = await handle(post("/v1/billing/portal", {}, session));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url: string }).url).toContain("billing.stripe.com");
  });
});
