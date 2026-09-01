/**
 * Billing: checkout session shaping (signed-in vs web), the webhook as the
 * paying users' tier write path, and the signature fence. The Stripe API is
 * a fake injected through ports.stripe.fetch; webhook signatures are REAL
 * HMACs so the verification code path is exercised, not stubbed.
 */
import { describe, expect, test } from "bun:test";
import type { AccountResponse } from "@read-aware/core";
import type { RelayPorts } from "../src/ports";
import { del, get, login, makeRelay, post } from "./harness";

const WHSEC = "whsec_test_secret";
const BASE_NOW = 1_755_000_000_000;

type Handle = (req: Request) => Promise<Response>;

/** A fake api.stripe.com; records every call's path and form body. */
function fakeStripe(
  options: {
    activeSubs?: number;
    foreignActiveSubs?: number;
    readAwareStatus?: string;
    foreignPrice?: boolean;
    paginatedOwnedSubscription?: boolean;
    failSubscriptionCancel?: boolean;
  } = {},
) {
  const calls: {
    url: string;
    method: string;
    form: URLSearchParams | null;
    idempotencyKey: string | null;
  }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const form = init?.body ? new URLSearchParams(String(init.body)) : null;
    const idempotencyKey = new Headers(init?.headers).get("idempotency-key");
    calls.push({ url, method, form, idempotencyKey });
    if (url.includes("/v1/prices")) {
      const lookup = new URL(url).searchParams.get("lookup_keys[]") ?? "";
      const tier = lookup.match(/^readaware_(sync|pro|max)_monthly$/)?.[1];
      const cents = { sync: 500, pro: 2_000, max: 5_000 }[tier as "sync" | "pro" | "max"];
      return Response.json({
        data: [
          {
            id: `price_fake_${lookup}`,
            lookup_key: lookup,
            currency: "usd",
            unit_amount: cents,
            recurring: { interval: "month", interval_count: 1 },
            metadata: {
              application: options.foreignPrice ? "another-product" : "readaware",
              tier,
            },
            product: { metadata: { application: "readaware", tier } },
          },
        ],
      });
    }
    if (url.includes("/v1/subscriptions") && method === "DELETE") {
      if (options.failSubscriptionCancel) {
        return Response.json({ error: { message: "cancel exploded" } }, { status: 500 });
      }
      return Response.json({ id: url.split("/").pop(), status: "canceled" });
    }
    if (url.includes("/v1/subscriptions")) {
      const startingAfter = new URL(url).searchParams.get("starting_after");
      if (options.paginatedOwnedSubscription && !startingAfter) {
        return Response.json({
          data: Array.from({ length: 100 }, (_, index) => ({
            id: `sub_foreign_${index}`,
            status: "active",
            metadata: { application: "another-product" },
          })),
          has_more: true,
        });
      }
      if (options.paginatedOwnedSubscription) {
        return Response.json({
          data: [
            {
              id: "sub_readaware_second_page",
              status: "active",
              metadata: { application: "readaware" },
            },
          ],
          has_more: false,
        });
      }
      return Response.json({
        data: [
          ...Array(options.activeSubs ?? 0).fill({
            id: "sub_readaware",
            status: options.readAwareStatus ?? "active",
            metadata: { application: "readaware" },
          }),
          ...Array(options.foreignActiveSubs ?? 0).fill({
            id: "sub_other",
            status: "active",
            metadata: { application: "another-product" },
          }),
        ],
      });
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

function relayWithStripe(
  options: {
    activeSubs?: number;
    foreignActiveSubs?: number;
    readAwareStatus?: string;
    foreignPrice?: boolean;
    paginatedOwnedSubscription?: boolean;
    failSubscriptionCancel?: boolean;
    portalConfigurationId?: string | null;
    config?: Partial<RelayPorts["config"]>;
  } = {},
) {
  const stripe = fakeStripe(options);
  const ports: RelayPorts["stripe"] = {
    secretKey: "sk_test_fake",
    webhookSecret: WHSEC,
    portalConfigurationId:
      options.portalConfigurationId === null
        ? undefined
        : (options.portalConfigurationId ?? "bpc_readaware"),
    fetch: stripe.fetchFn,
  };
  // relayOrigin is CONFIG, never req.url — wrangler dev rewrites the request
  // host to the production route domain, which is exactly the bug this guards.
  return {
    ...makeRelay(
      { relayOrigin: "https://relay.test", ...options.config },
      {},
      {},
      ports,
    ),
    stripe,
  };
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

function checkout(
  body: { plan: "sync" | "pro" | "max"; ticket?: string },
  options: { session?: string; ip?: string } = {},
): Request {
  const request = post("/v1/billing/checkout", body, options.session);
  request.headers.set("cf-connecting-ip", options.ip ?? "203.0.113.10");
  return request;
}

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
    expect(created.form?.get("line_items[0][price]")).toBe("price_fake_readaware_pro_monthly");
    expect(created.form?.get("metadata[application]")).toBe("readaware");
    expect(created.form?.get("metadata[tier]")).toBe("pro");
    expect(created.form?.get("subscription_data[metadata][application]")).toBe("readaware");
    expect(created.form?.get("allow_promotion_codes")).toBeNull();
    expect(created.form?.get("customer_email")).toBeNull();
    expect(created.form?.get("client_reference_id")).toBeNull();
    // The locale rides into the return URLs.
    expect(created.form?.get("success_url")).toBe("https://readaware.app/zh/pricing?purchase=success");
  });

  test("fails closed when the lookup key points at another product's price", async () => {
    const { handle } = relayWithStripe({ foreignPrice: true });
    expect((await handle(post("/v1/billing/checkout", { plan: "pro" }))).status).toBe(502);
  });

  test("signed-in checkout binds the account and locks the email", async () => {
    const { handle, stripe } = relayWithStripe();
    const { session, accountId } = await login(handle, "reader@example.com");
    const res = await handle(post("/v1/billing/checkout", { plan: "sync" }, session));
    expect(res.status).toBe(200);
    const created = stripe.calls.find((c) => c.url.includes("/v1/checkout/sessions"))!;
    expect(created.form?.get("customer_email")).toBe("reader@example.com");
    expect(created.form?.get("client_reference_id")).toBe(accountId);
    expect(created.idempotencyKey).toMatch(/^readaware-checkout-[a-f0-9]{64}$/);
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
          metadata: { application: "readaware", tier: "pro" },
        },
      },
    });
    expect((await handle(post("/v1/billing/checkout", { plan: "max" }, session))).status).toBe(409);
  });

  test.each(["trialing", "past_due", "incomplete", "unpaid", "paused"])(
    "a %s ReadAware subscription blocks a duplicate checkout",
    async (status) => {
      const { handle } = relayWithStripe({ activeSubs: 1, readAwareStatus: status });
      const { session, accountId } = await login(handle, "reader@example.com");
      await webhook(handle, {
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "subscription",
            client_reference_id: accountId,
            customer: "cus_1",
            metadata: { application: "readaware", tier: "pro" },
          },
        },
      });
      expect((await handle(post("/v1/billing/checkout", { plan: "max" }, session))).status).toBe(409);
    },
  );

  test("finds a ReadAware subscription after a full foreign first page", async () => {
    const { handle } = relayWithStripe({ paginatedOwnedSubscription: true });
    const { session, accountId } = await login(handle, "reader@example.com");
    await webhook(handle, {
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          client_reference_id: accountId,
          customer: "cus_1",
          metadata: { application: "readaware", tier: "pro" },
        },
      },
    });
    expect((await handle(post("/v1/billing/checkout", { plan: "max" }, session))).status).toBe(409);
  });

  test("another product's subscription does not block ReadAware checkout", async () => {
    const { handle } = relayWithStripe({ foreignActiveSubs: 1 });
    const { session, accountId } = await login(handle, "reader@example.com");
    await webhook(handle, {
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          client_reference_id: accountId,
          customer: "cus_1",
          metadata: { application: "readaware", tier: "pro" },
        },
      },
    });
    expect((await handle(post("/v1/billing/checkout", { plan: "max" }, session))).status).toBe(200);
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
        metadata: { application: "readaware", tier },
      },
    },
  });

  test("a foreign checkout cannot create or upgrade a ReadAware account", async () => {
    const { handle } = relayWithStripe();
    const { session, accountId } = await login(handle, "reader@example.com");
    const event = completed(accountId, null);
    event.data.object.metadata = { application: "another-product", tier: "pro" };
    expect((await webhook(handle, event)).status).toBe(200);
    const account = await accountOf(handle, session);
    expect(account.tier).toBe("free");
    expect(account.hasBilling).toBe(false);
  });

  test("signed-in purchase upgrades the account and links the customer", async () => {
    const { handle } = relayWithStripe();
    const { session, accountId } = await login(handle, "reader@example.com");
    expect((await webhook(handle, completed(accountId, null))).status).toBe(200);
    const account = await accountOf(handle, session);
    expect(account.tier).toBe("pro");
    expect(account.hasBilling).toBe(true);
  });

  test("an anonymous purchase cannot rebind an existing billing customer", async () => {
    const { handle } = relayWithStripe();
    const { session } = await paidAccount(handle);
    const event = completed(null, "reader@example.com", "max");
    event.data.object.customer = "cus_attacker";
    expect((await webhook(handle, event)).status).toBe(200);
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
        metadata: { application: "readaware" },
        items: {
          data: [
            {
              price: {
                lookup_key: "readaware_pro_monthly",
                currency: "usd",
                unit_amount: 2_000,
                recurring: { interval: "month", interval_count: 1 },
                metadata: { application: "readaware", tier: "pro" },
              },
            },
          ],
        },
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
        items: {
          data: [
            {
              price: {
                lookup_key: "readaware_max_monthly",
                currency: "usd",
                unit_amount: 5_000,
                recurring: { interval: "month", interval_count: 1 },
                metadata: { application: "readaware", tier: "max" },
              },
            },
          ],
        },
      }),
    );
    expect((await accountOf(handle, session)).tier).toBe("max");
  });

  test("a mis-tagged sibling price cannot re-tier a ReadAware account", async () => {
    const { handle } = relayWithStripe();
    const { session } = await paidAccount(handle);
    await webhook(
      handle,
      subscriptionEvent("customer.subscription.updated", {
        items: {
          data: [
            {
              price: {
                lookup_key: "readaware_max_monthly",
                currency: "usd",
                unit_amount: 5_000,
                recurring: { interval: "month", interval_count: 1 },
                metadata: { application: "another-product", tier: "max" },
              },
            },
          ],
        },
      }),
    );
    expect((await accountOf(handle, session)).tier).toBe("pro");
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
              price: {
                lookup_key: "readaware_pro_monthly",
                currency: "usd",
                unit_amount: 2_000,
                recurring: { interval: "month", interval_count: 1 },
                metadata: { application: "readaware", tier: "pro" },
              },
            },
          ],
        },
      }),
    );
    expect((await accountOf(handle, session)).tier).toBe("pro");
    advance(8 * 24 * 60 * 60 * 1000);
    expect((await accountOf(handle, session)).tier).toBe("free");
  });

  test("another product's deletion cannot downgrade a ReadAware subscription", async () => {
    const { handle } = relayWithStripe();
    const { session } = await paidAccount(handle);
    await webhook(
      handle,
      subscriptionEvent("customer.subscription.deleted", {
        metadata: { application: "another-product" },
      }),
    );
    expect((await accountOf(handle, session)).tier).toBe("pro");
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

  test("missing portal configuration disables only the portal", async () => {
    const { handle } = relayWithStripe({ portalConfigurationId: null });
    const { session, accountId } = await login(handle, "reader@example.com");
    await webhook(handle, {
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          client_reference_id: accountId,
          customer: "cus_1",
          metadata: { application: "readaware", tier: "pro" },
        },
      },
    });
    expect((await accountOf(handle, session)).tier).toBe("pro");
    expect((await handle(post("/v1/billing/portal", {}, session))).status).toBe(502);
  });

  test("hands back the hosted portal URL for a paying account", async () => {
    const { handle, stripe } = relayWithStripe();
    const { session, accountId } = await login(handle, "reader@example.com");
    await webhook(handle, {
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          client_reference_id: accountId,
          customer: "cus_1",
          metadata: { application: "readaware", tier: "pro" },
        },
      },
    });
    const res = await handle(post("/v1/billing/portal", {}, session));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url: string }).url).toContain("billing.stripe.com");
    const created = stripe.calls.find((call) => call.url.includes("/v1/billing_portal/sessions"));
    expect(created?.form?.get("configuration")).toBe("bpc_readaware");
  });
});

describe("checkout throttles", () => {
  test("the per-IP cap covers anonymous and bearer doors", async () => {
    const { handle, stripe } = relayWithStripe({
      config: { checkoutPerIpPerHour: 2, checkoutPerAccountPerHour: 10 },
    });
    expect((await handle(checkout({ plan: "pro" }))).status).toBe(200);
    expect((await handle(checkout({ plan: "pro" }))).status).toBe(200);

    const { session } = await login(handle, "reader@example.com");
    expect((await handle(checkout({ plan: "pro" }, { session, ip: "203.0.113.10" }))).status).toBe(
      429,
    );
    expect((await handle(checkout({ plan: "pro" }, { session, ip: "203.0.113.11" }))).status).toBe(
      200,
    );

    // The blocked bearer call never reached Stripe.
    expect(stripe.calls.filter((c) => c.url.includes("/v1/checkout/sessions")).length).toBe(3);
  });

  test("bearer and reusable ticket checkouts share one account cap across IPs", async () => {
    const { handle, stripe } = relayWithStripe({
      config: { checkoutPerIpPerHour: 10, checkoutPerAccountPerHour: 2 },
    });
    const { session } = await login(handle, "reader@example.com");
    expect((await handle(checkout({ plan: "pro" }, { session, ip: "203.0.113.20" }))).status).toBe(
      200,
    );

    const minted = await handle(post("/v1/billing/ticket", {}, session));
    const { ticket } = (await minted.json()) as { ticket: string };
    expect((await handle(checkout({ plan: "pro", ticket }, { ip: "203.0.113.21" }))).status).toBe(
      200,
    );
    expect((await handle(checkout({ plan: "pro", ticket }, { ip: "203.0.113.22" }))).status).toBe(
      429,
    );

    expect(stripe.calls.filter((c) => c.url.includes("/v1/checkout/sessions")).length).toBe(2);
  });
});

describe("account deletion", () => {
  const bindCustomer = async (handle: Handle, accountId: string) =>
    webhook(handle, {
      type: "checkout.session.completed",
      data: {
        object: {
          mode: "subscription",
          client_reference_id: accountId,
          customer: "cus_1",
          metadata: { application: "readaware", tier: "pro" },
        },
      },
    });

  test("cancels the account's ReadAware subscriptions and only those", async () => {
    const { handle, stripe } = relayWithStripe({ activeSubs: 1, foreignActiveSubs: 1 });
    const { session, accountId } = await login(handle, "reader@example.com");
    await bindCustomer(handle, accountId);

    expect((await handle(del("/v1/account", session))).status).toBe(204);

    const cancels = stripe.calls.filter(
      (c) => c.method === "DELETE" && c.url.includes("/v1/subscriptions/"),
    );
    expect(cancels.map((c) => c.url.split("/").pop())).toEqual(["sub_readaware"]);
    // The session died with the account.
    expect((await handle(get("/v1/account", session))).status).toBe(401);
  });

  test("an account with no billing profile deletes without calling Stripe", async () => {
    const { handle, stripe } = relayWithStripe();
    const { session } = await login(handle, "reader@example.com");
    expect((await handle(del("/v1/account", session))).status).toBe(204);
    expect(stripe.calls.some((c) => c.url.includes("/v1/subscriptions"))).toBe(false);
  });

  test("a Stripe cancel failure aborts the deletion — no wiped-but-billing account", async () => {
    const { handle, stripe } = relayWithStripe({ activeSubs: 1, failSubscriptionCancel: true });
    const { session, accountId } = await login(handle, "reader@example.com");
    await bindCustomer(handle, accountId);

    expect((await handle(del("/v1/account", session))).status).toBe(502);
    expect(stripe.calls.some((c) => c.method === "DELETE")).toBe(true);
    // Account and session both survive; the user can retry.
    expect((await handle(get("/v1/account", session))).status).toBe(200);
  });
});
