/**
 * Stripe billing over plain fetch + WebCrypto — the relay stays
 * dependency-free. Three surfaces (docs/sync-engine.md §11):
 *
 * - checkout: mint a Stripe Checkout session for a plan. Prices are looked
 *   up by namespaced lookup_key (readaware_sync_monthly /
 *   readaware_pro_monthly / readaware_max_monthly) so the code
 *   never hardcodes price ids — rebuilding the catalog in live mode changes
 *   nothing here.
 * - webhook: THE tier write path for paying users. Signature-verified;
 *   fulfillment is keyed to the account by client_reference_id (in-app
 *   checkout) or by the checkout email (web checkout, where the buyer signs
 *   in later with the same address — accounts are keyed by email anyway).
 * - portal: Stripe's hosted subscription management for plan changes and
 *   cancellation; the relay never mutates subscriptions itself.
 *
 * The webhook writes through the SAME seam as /v1/admin/tier. Stripe is the
 * source of truth for who paid; the account row only mirrors it.
 */
import type { AccountStore, StripePorts } from "./ports";

const STRIPE_API = "https://api.stripe.com";

export const BILLING_PLANS = ["sync", "pro", "max"] as const;
export type BillingPlan = (typeof BILLING_PLANS)[number];

export const isBillingPlan = (v: unknown): v is BillingPlan =>
  typeof v === "string" && (BILLING_PLANS as readonly string[]).includes(v);

/** Price lookup_keys — the stable names seeded in the Stripe catalog. */
const PLAN_LOOKUP_KEY: Record<BillingPlan, string> = {
  sync: "readaware_sync_monthly",
  pro: "readaware_pro_monthly",
  max: "readaware_max_monthly",
};

const PLAN_PRICE_CENTS: Record<BillingPlan, number> = {
  sync: 500,
  pro: 2_000,
  max: 5_000,
};

/**
 * This Stripe account hosts more than one product. Every mutable billing
 * object ReadAware creates carries this marker; webhook traffic without it is
 * somebody else's and must be acknowledged without touching our accounts.
 */
const STRIPE_APP = "readaware";
const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
const belongsToReadAware = (object: unknown): boolean =>
  asRecord(asRecord(object)?.metadata)?.application === STRIPE_APP;

function planOfCanonicalPrice(value: unknown, requireExpandedProduct: boolean): BillingPlan | null {
  const price = asRecord(value);
  const recurring = asRecord(price?.recurring);
  const plan = (Object.entries(PLAN_LOOKUP_KEY) as [BillingPlan, string][]).find(
    ([, lookupKey]) => price?.lookup_key === lookupKey,
  )?.[0];
  if (
    !price ||
    !plan ||
    !belongsToReadAware(price) ||
    asRecord(price.metadata)?.tier !== plan ||
    price.currency !== "usd" ||
    price.unit_amount !== PLAN_PRICE_CENTS[plan] ||
    recurring?.interval !== "month" ||
    recurring.interval_count !== 1 ||
    (requireExpandedProduct && !belongsToReadAware(price.product))
  ) {
    return null;
  }
  return plan;
}

export class StripeError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(`stripe ${status}: ${message}`);
    this.name = "StripeError";
  }
}

/**
 * One Stripe API call, form-encoded the way Stripe wants (nested keys are
 * spelled out by the caller: "line_items[0][price]").
 */
async function stripeApi(
  stripe: StripePorts,
  method: "GET" | "POST",
  path: string,
  params: Record<string, string> = {},
  options: { idempotencyKey?: string } = {},
): Promise<Record<string, unknown>> {
  const fetchFn = stripe.fetch ?? fetch;
  const encoded = new URLSearchParams(params).toString();
  const url = method === "GET" && encoded ? `${STRIPE_API}${path}?${encoded}` : `${STRIPE_API}${path}`;
  const res = await fetchFn(url, {
    method,
    headers: {
      authorization: `Bearer ${stripe.secretKey}`,
      ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
    },
    body: method === "POST" ? encoded : undefined,
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const error = body.error as { message?: string } | undefined;
    throw new StripeError(res.status, error?.message ?? "stripe request failed");
  }
  return body;
}

/**
 * Billing state shared across requests in one handler: the lookup_key →
 * price id cache (prices are immutable once created; a cold isolate pays one
 * extra GET per plan).
 */
export type BillingContext = {
  stripe: StripePorts;
  priceIds: Map<BillingPlan, string>;
};

export const createBillingContext = (stripe: StripePorts): BillingContext => ({
  stripe,
  priceIds: new Map(),
});

async function priceIdFor(ctx: BillingContext, plan: BillingPlan): Promise<string> {
  const cached = ctx.priceIds.get(plan);
  if (cached) return cached;
  const listed = await stripeApi(ctx.stripe, "GET", "/v1/prices", {
    "lookup_keys[]": PLAN_LOOKUP_KEY[plan],
    "expand[]": "data.product",
    active: "true",
    limit: "1",
  });
  const price = asRecord((listed.data as unknown[] | undefined)?.[0]);
  if (
    !price ||
    typeof price.id !== "string" ||
    planOfCanonicalPrice(price, true) !== plan
  ) {
    throw new StripeError(500, `no valid ReadAware price with lookup_key ${PLAN_LOOKUP_KEY[plan]}`);
  }
  ctx.priceIds.set(plan, price.id);
  return price.id;
}

const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete_expired"]);

async function hasCurrentReadAwareSubscription(
  ctx: BillingContext,
  customerId: string,
): Promise<boolean> {
  let startingAfter: string | undefined;
  do {
    const listed = await stripeApi(ctx.stripe, "GET", "/v1/subscriptions", {
      customer: customerId,
      status: "all",
      limit: "100",
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const subscriptions = (listed.data as unknown[] | undefined) ?? [];
    if (
      subscriptions.some((subscription) => {
        const object = asRecord(subscription);
        return (
          belongsToReadAware(object) &&
          !TERMINAL_SUBSCRIPTION_STATUSES.has(String(object?.status ?? ""))
        );
      })
    ) {
      return true;
    }
    if (listed.has_more !== true || subscriptions.length === 0) return false;
    const last = asRecord(subscriptions[subscriptions.length - 1]);
    if (typeof last?.id !== "string") return false;
    startingAfter = last.id;
  } while (true);
}

export type CheckoutRequest = {
  plan: BillingPlan;
  successUrl: string;
  cancelUrl: string;
  /** Signed-in checkout: ties fulfillment to the account and locks the email. */
  account?: { id: string; email: string; stripeCustomerId: string | null };
};

/**
 * Returns the hosted checkout URL. A signed-in account that already carries
 * an active subscription is refused with 409 — plan changes go through the
 * portal; a second checkout would mint a second subscription.
 */
export async function createCheckoutSession(
  ctx: BillingContext,
  request: CheckoutRequest,
): Promise<{ url: string }> {
  const account = request.account;
  if (account?.stripeCustomerId) {
    // Stripe cannot filter subscription lists by metadata. Walk every page
    // and reject only a non-terminal ReadAware subscription, never another
    // product's or a canceled/expired historical object.
    if (await hasCurrentReadAwareSubscription(ctx, account.stripeCustomerId)) {
      throw new StripeError(409, "a ReadAware subscription exists; manage it in the portal");
    }
  }

  const params: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": await priceIdFor(ctx, request.plan),
    "line_items[0][quantity]": "1",
    success_url: request.successUrl,
    cancel_url: request.cancelUrl,
    // Both the one-shot Checkout Session and durable Subscription are scoped:
    // the account also processes payments for unrelated products.
    "metadata[application]": STRIPE_APP,
    "metadata[tier]": request.plan,
    "subscription_data[metadata][application]": STRIPE_APP,
    "subscription_data[metadata][tier]": request.plan,
    // Promotion codes are account-global. Leave them disabled until every
    // allowed code is explicitly product-restricted to ReadAware.
  };
  if (account) {
    params.client_reference_id = account.id;
    if (account.stripeCustomerId) params.customer = account.stripeCustomerId;
    else params.customer_email = account.email;
  }
  const idempotencyKey = account
    ? `readaware-checkout-${await sha256Hex(
        `${account.id}\n${request.plan}\n${request.successUrl}\n${request.cancelUrl}`,
      )}`
    : undefined;
  const session = await stripeApi(ctx.stripe, "POST", "/v1/checkout/sessions", params, {
    idempotencyKey,
  });
  if (typeof session.url !== "string") throw new StripeError(500, "checkout session has no url");
  return { url: session.url };
}

export async function createPortalSession(
  ctx: BillingContext,
  customerId: string,
  returnUrl: string,
): Promise<{ url: string }> {
  if (!ctx.stripe.portalConfigurationId) {
    throw new StripeError(500, "ReadAware billing portal is not configured");
  }
  const session = await stripeApi(ctx.stripe, "POST", "/v1/billing_portal/sessions", {
    customer: customerId,
    return_url: returnUrl,
    // Never use the account-wide default: other products share this Stripe
    // account and keep independent plan-change/cancellation policy.
    configuration: ctx.stripe.portalConfigurationId,
  });
  if (typeof session.url !== "string") throw new StripeError(500, "portal session has no url");
  return { url: session.url };
}

// ── Webhook ─────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(message));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Digest-compare: equality timing depends on hashes, never on the secrets. */
async function digestEquals(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all(
    [a, b].map(async (v) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(v)))),
  );
  return da.length === db.length && da.every((byte, i) => byte === db[i]);
}

/**
 * Stripe-Signature: `t=<unix>,v1=<hex>[,v1=...]`. Valid when any v1 matches
 * HMAC-SHA256(secret, `${t}.${payload}`) and t is within tolerance (replay
 * fence). https://docs.stripe.com/webhooks#verify-manually
 */
export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowMs: number,
  toleranceMs = 5 * 60 * 1000,
): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",").map((part) => part.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const candidates = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!t || !/^\d+$/.test(t) || candidates.length === 0) return false;
  if (Math.abs(nowMs - Number(t) * 1000) > toleranceMs) return false;
  const expected = await hmacSha256Hex(secret, `${t}.${payload}`);
  for (const candidate of candidates) {
    if (await digestEquals(expected, candidate)) return true;
  }
  return false;
}

// ── Event fulfillment ───────────────────────────────────────────────────────

type StripeEvent = { type?: unknown; data?: { object?: unknown } };

/** A subscription is one exact, canonical ReadAware monthly price. */
function planOfSubscription(sub: Record<string, unknown>): BillingPlan | null {
  const items = asRecord(sub.items);
  const data = (items?.data as unknown[] | undefined) ?? [];
  if (data.length !== 1) return null;
  return planOfCanonicalPrice(asRecord(data[0])?.price, false);
}

/** Newer API versions moved current_period_end onto the subscription item. */
function periodEndMs(sub: Record<string, unknown>): number | null {
  const top = sub.current_period_end;
  if (typeof top === "number") return top * 1000;
  const items = asRecord(sub.items);
  const first = asRecord((items?.data as unknown[] | undefined)?.[0]);
  return typeof first?.current_period_end === "number" ? first.current_period_end * 1000 : null;
}

/**
 * Apply one verified Stripe event to the account table. Idempotent by
 * construction (every write is a plain overwrite), so Stripe's at-least-once
 * delivery needs no dedup ledger. Unknown event types are acknowledged and
 * ignored — the endpoint's subscription list decides what arrives.
 */
export async function applyStripeEvent(accounts: AccountStore, event: StripeEvent, nowIso: string): Promise<void> {
  const object = asRecord(event.data?.object);
  if (!object || !belongsToReadAware(object)) return;

  if (event.type === "checkout.session.completed") {
    if (object.mode !== "subscription") return;
    const tier = asRecord(object.metadata)?.tier;
    // Validate the complete fulfillment claim before creating or linking an
    // account. A malformed/foreign event must leave no partial billing row.
    if (!isBillingPlan(tier) || typeof object.customer !== "string") return;
    const accountId = typeof object.client_reference_id === "string" ? object.client_reference_id : null;
    let account = accountId ? await accounts.get(accountId) : null;
    if (!account) {
      // Web checkout: no session, only the paid email. Accounts are keyed by
      // email, so fulfillment pre-creates the row the buyer will sign into.
      const email =
        asRecord(object.customer_details)?.email ?? object.customer_email;
      if (typeof email !== "string" || !email) return;
      account = await accounts.findOrCreateByEmail(email.trim().toLowerCase(), nowIso);
    }
    // A signed-out buyer can type any email into Checkout. Never let that
    // rebind an account which already owns a different billing customer; the
    // verified account must use its in-app checkout/portal instead.
    if (account.stripeCustomerId && account.stripeCustomerId !== object.customer) return;
    await accounts.setStripeCustomer(account.id, object.customer);
    await accounts.setTierById(account.id, tier, null);
    return;
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    if (typeof object.customer !== "string") return;
    const account = await accounts.findByStripeCustomer(object.customer);
    if (!account) return; // a customer we never linked — not ours to touch

    if (event.type === "customer.subscription.deleted") {
      await accounts.setTierById(account.id, "free", null);
      return;
    }
    const status = object.status;
    if (status === "canceled" || status === "unpaid" || status === "incomplete_expired") {
      await accounts.setTierById(account.id, "free", null);
      return;
    }
    if (status !== "active" && status !== "trialing") return; // past_due etc.: grace, no change
    const plan = planOfSubscription(object);
    if (!plan) return;
    const expiry = object.cancel_at_period_end === true ? periodEndMs(object) : null;
    await accounts.setTierById(account.id, plan, expiry);
  }
}
