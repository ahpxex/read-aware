/**
 * The relay's seams. Every handler in router.ts runs against these interfaces;
 * the Worker entry (index.ts) binds them to D1 / Durable Objects / R2, and the
 * tests bind the SAME sql-backed cores to bun:sqlite — so what the suite
 * exercises is the real storage logic, not a parallel in-memory fiction.
 */
import type {
  SealedEventWire,
  SyncKeyMaterial,
  SyncTier,
  SyncTierLimits,
} from "@read-aware/core";
import type { AiModel } from "./ai-proxy";
import type { RelayLang } from "./i18n";

export const ACCOUNT_TIERS: readonly SyncTier[] = ["free", "sync", "pro", "max", "staff"];

export const isAccountTier = (v: unknown): v is SyncTier =>
  typeof v === "string" && (ACCOUNT_TIERS as readonly string[]).includes(v);

export type Account = {
  id: string;
  email: string;
  keys: SyncKeyMaterial | null;
  blobBytesUsed: number;
  /** As stored — resolve through `resolveTier` before reading quotas off it. */
  tier: SyncTier;
  tierExpiresAtMs: number | null;
  /** Linked at first checkout; subscription webhooks find the account by it. */
  stripeCustomerId: string | null;
  createdAt: string;
};

/**
 * The stored tier, downgraded to `free` once its expiry passes. Enforcement
 * is write-time only: an over-quota downgraded account keeps pulling and
 * reading forever — data is never deleted, new pushes are refused.
 */
export function resolveTier(
  account: Pick<Account, "tier" | "tierExpiresAtMs">,
  nowMs: number,
): SyncTier {
  if (account.tier === "free") return "free";
  if (account.tierExpiresAtMs !== null && account.tierExpiresAtMs <= nowMs) return "free";
  return account.tier;
}

/**
 * Tier → quota mapping — code, not rows, so changing a tier's quotas is a
 * deploy, never a data migration. `free` reads the (env-overridable) config
 * baseline; paid tiers are fixed here. null = unlimited.
 *
 * Numbers, with the bill math that justifies them (R2 ≈ $0.015/GB-month):
 * - sync ($5/month): pro's data quotas with zero AI — the plan for BYOK
 *   users who want multi-device sync and already hold their own LLM key.
 *   Worst case ≈ $0.15/month of storage; ~97% margin.
 * - pro: 10 GiB of books + 2.5M events — effectively "your whole library",
 *   worst case ≈ $0.15/month/account of storage.
 * - max: 100 GiB + 25M events — an order of magnitude of headroom,
 *   worst case ≈ $1.50/month/account.
 * - staff: internal accounts, unmetered.
 * Per-file stays 100 MB on every paid tier: the Worker buffers uploads and
 * Cloudflare caps request bodies at 100 MB on non-enterprise plans anyway —
 * raising it needs multipart upload work, not a bigger constant.
 *
 * Events ladder reads 50k → 2.5M → 25M: a clean 50× / 10× story, and event
 * rows are so small the cost difference is noise.
 *
 * aiMonthlyCredits is the bundled-AI budget (1 credit = $0.001; ai-proxy.ts):
 * free = 0 — bundled AI is a paid feature, BYOK is always available; an
 * open-source client base with a free LLM allowance is a bill nobody can
 * bound. pro 5,000 ≈ 1,200+ DeepSeek-Flash turns/month; max 30,000. Against
 * the decided pricing (pro $20, max $50 — 2026-08-19) the metering ceilings
 * leave hard worst-case margins of $15 and $20: even an account that burns
 * its budget to the last credit is profitable.
 */
export function quotasForTier(tier: SyncTier, config: RelayConfig): SyncTierLimits {
  switch (tier) {
    case "free":
      return {
        maxBlobBytes: config.maxBlobBytes,
        maxAccountBlobBytes: config.maxAccountBlobBytes,
        maxAccountEvents: config.maxAccountEvents,
        aiMonthlyCredits: 0,
      };
    case "sync":
      return {
        maxBlobBytes: 100 * 1024 * 1024,
        maxAccountBlobBytes: 10 * 1024 * 1024 * 1024,
        maxAccountEvents: 2_500_000,
        aiMonthlyCredits: 0,
      };
    case "pro":
      return {
        maxBlobBytes: 100 * 1024 * 1024,
        maxAccountBlobBytes: 10 * 1024 * 1024 * 1024,
        maxAccountEvents: 2_500_000,
        aiMonthlyCredits: 5_000,
      };
    case "max":
      return {
        maxBlobBytes: 100 * 1024 * 1024,
        maxAccountBlobBytes: 100 * 1024 * 1024 * 1024,
        maxAccountEvents: 25_000_000,
        aiMonthlyCredits: 30_000,
      };
    case "staff":
      return {
        maxBlobBytes: 100 * 1024 * 1024,
        maxAccountBlobBytes: null,
        maxAccountEvents: null,
        aiMonthlyCredits: null,
      };
  }
}

export interface AccountStore {
  findOrCreateByEmail(email: string, now: string): Promise<Account>;
  get(id: string): Promise<Account | null>;
  /** Set-once: the first device publishes, everyone else reads. */
  setKeys(id: string, keys: SyncKeyMaterial): Promise<"set" | "already-set">;
  putMagicToken(tokenHash: string, email: string, expiresAtMs: number, now: string): Promise<void>;
  /** Atomic single-use redemption; null = unknown, spent, or expired. */
  consumeMagicToken(tokenHash: string, nowMs: number): Promise<string | null>;
  putOauthState(
    stateHash: string,
    provider: string,
    client: OAuthClientKind,
    lang: string,
    expiresAtMs: number,
    now: string,
  ): Promise<void>;
  /** Single-use; returns what the state was minted for, or null. */
  consumeOauthState(
    stateHash: string,
    nowMs: number,
  ): Promise<{ provider: string; client: OAuthClientKind; lang: string } | null>;
  putSession(tokenHash: string, accountId: string, now: string): Promise<void>;
  sessionAccount(tokenHash: string): Promise<string | null>;
  /** One-shot doorbell-socket ticket (the session must never ride in a URL). */
  putWatchTicket(tokenHash: string, accountId: string, expiresAtMs: number): Promise<void>;
  /** Atomic single-use redemption; null = unknown, spent, or expired. */
  consumeWatchTicket(tokenHash: string, nowMs: number): Promise<string | null>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Returns the new total. Clamped at zero (deletes never go negative). */
  adjustBlobBytes(id: string, delta: number): Promise<number>;
  /**
   * The tier write seam, admin flavor — keyed by email, that is how an
   * operator identifies an account. Returns the updated account, or null
   * when no account has that email.
   */
  setTierByEmail(
    email: string,
    tier: SyncTier,
    tierExpiresAtMs: number | null,
  ): Promise<Account | null>;
  /** The same seam, webhook flavor — the billing handler already holds the id. */
  setTierById(id: string, tier: SyncTier, tierExpiresAtMs: number | null): Promise<void>;
  setStripeCustomer(id: string, customerId: string): Promise<void>;
  findByStripeCustomer(customerId: string): Promise<Account | null>;
  deleteAccount(id: string): Promise<void>;
}

/** One account's numbered ciphertext mailbox. */
export interface Mailbox {
  /**
   * Event id → server_seq; known ids return their existing seq. "full" =
   * accepting the batch's NEW events would exceed `maxEvents` — refused
   * atomically, nothing appended (redelivery of known ids still succeeds).
   */
  append(events: SealedEventWire[], maxEvents: number): Promise<Record<string, number> | "full">;
  /** Stored events — the usage half of the quota (`/v1/account` reporting). */
  count(): Promise<number>;
  listAfter(after: number, limit: number): Promise<{ events: SealedEventWire[]; next: number }>;
  wipe(): Promise<void>;
  /**
   * Accept a WebSocket Upgrade — the change doorbell (`{type:"changed",seq}`
   * on every append). Optional: a transport without sockets (tests) omits it
   * and the route answers 501.
   */
  watch?(req: Request): Promise<Response>;
}

export interface BlobStore {
  put(accountId: string, key: string, bytes: Uint8Array): Promise<void>;
  get(accountId: string, key: string): Promise<Uint8Array | null>;
  /** Returns the byte size freed (0 when the key was absent). */
  delete(accountId: string, key: string): Promise<number>;
  wipe(accountId: string): Promise<void>;
}

/**
 * User-initiated diagnostic reports (the app's "send report" flow — never
 * automatic). Metadata rows make listing and per-IP throttling queryable; the
 * payload itself is an opaque JSON document in blob storage. Reports are
 * write-only through the HTTP surface: the operator reads them with wrangler
 * (docs/diagnostics.md), so a scraped endpoint can leak nothing.
 */
export type DiagnosticReportMeta = {
  id: string;
  createdAt: string;
  createdAtMs: number;
  /** SHA-256 of the client IP — enough to throttle, nothing to identify. */
  ipHash: string;
  appVersion: string;
  platform: string;
  bytes: number;
};

export interface ReportStore {
  submit(meta: DiagnosticReportMeta, payload: Uint8Array): Promise<void>;
  /** Reports this ipHash has submitted since `sinceMs` — the throttle input. */
  countSince(ipHash: string, sinceMs: number): Promise<number>;
}

/** Monthly bundled-AI accounting (migrations/0007): micro-USD per account-month. */
export interface AiUsageStore {
  usedMicroUsd(accountId: string, month: string): Promise<number>;
  /** One completed request's cost — upsert-increment, monotonic. */
  add(accountId: string, month: string, microUsd: number): Promise<void>;
}

export interface MagicLinkSender {
  /** `lang` is a resolved RelayLang — the email renders in the app's locale. */
  send(email: string, token: string, lang: RelayLang): Promise<void>;
}

/**
 * How an OAuth dance finishes: "app" renders the one-time sign-in token for
 * the desktop app to paste; "web" redirects straight back into the web app
 * with the token in the fragment. Same accounts, same everything after.
 */
export type OAuthClientKind = "app" | "web";

/**
 * One OAuth identity provider. The relay only ever wants ONE fact from it — a
 * verified email address — which then feeds the same account/token machinery
 * as the magic link. Providers are ports so the flow tests with fakes.
 */
export interface OAuthProvider {
  authorizeUrl(state: string, redirectUri: string): string;
  /** Exchange the callback code for a VERIFIED email; throw on anything else. */
  exchangeCode(code: string, redirectUri: string): Promise<string>;
}

export type RelayConfig = {
  /** Dev mode: return the magic token in the response instead of emailing. */
  echoMagicToken: boolean;
  magicTokenTtlMs: number;
  /** Per sealed event, JSON-encoded. */
  maxEventBytes: number;
  /** Events per push batch. */
  maxBatch: number;
  /** Events per pull page (also the default). */
  maxPullLimit: number;
  /** Per single blob — the FREE-tier baseline (paid tiers: `quotasForTier`). */
  maxBlobBytes: number;
  /** Per free-tier account, total. THE bill guard — an open-source client base
   * must never be able to run the operator's R2 bill up (docs/sync-engine.md
   * §11). Paid tiers read their own numbers from `quotasForTier`. */
  maxAccountBlobBytes: number;
  /** Per free-tier account, total events in the mailbox. Same guard for DO
   * storage. */
  maxAccountEvents: number;
  /** Bearer token for /v1/admin/* (wrangler secret); null disables the routes. */
  adminToken: string | null;
  /** Per AI proxy request body, JSON-encoded (reading contexts are big; books are not). */
  maxAiRequestBytes: number;
  /** Ceiling injected over a caller's max_tokens on the AI proxy. */
  maxAiOutputTokens: number;
  /** Where a `client=web` OAuth finish is allowed to land (no open redirect). */
  webAppOrigin: string;
  /** Per diagnostic report, JSON-encoded (the client caps log tails well below). */
  maxReportBytes: number;
  /** Diagnostic reports per IP per rolling day — the endpoint is unauthenticated. */
  maxReportsPerIpPerDay: number;
};

export const DEFAULT_CONFIG: RelayConfig = {
  echoMagicToken: false,
  magicTokenTtlMs: 15 * 60 * 1000,
  maxEventBytes: 64 * 1024,
  maxBatch: 500,
  maxPullLimit: 500,
  maxBlobBytes: 50 * 1024 * 1024,
  // Free-tier defaults, deliberately tight: 50 MB of books and 50k events per
  // account. 1000 free accounts at the cap ≈ 50 GB R2 ≈ $0.60/month — the
  // worst case is bounded and known. Raise per deployment via env vars
  // (MAX_ACCOUNT_BLOB_BYTES / MAX_ACCOUNT_EVENTS). Paid tiers read their
  // quotas off the account row's tier through `quotasForTier` instead.
  maxAccountBlobBytes: 50 * 1024 * 1024,
  maxAccountEvents: 50_000,
  adminToken: null,
  maxAiRequestBytes: 2 * 1024 * 1024,
  maxAiOutputTokens: 32_768,
  webAppOrigin: "https://readaware.app",
  maxReportBytes: 512 * 1024,
  maxReportsPerIpPerDay: 10,
};

/** Stripe billing wiring; null ⇒ /v1/billing/* answers 501. */
export type StripePorts = {
  secretKey: string;
  webhookSecret: string;
  /** Injectable so tests fake api.stripe.com. */
  fetch?: typeof fetch;
};

export type RelayPorts = {
  accounts: AccountStore;
  mailboxFor(accountId: string): Mailbox;
  blobs: BlobStore;
  reports: ReportStore;
  aiUsage: AiUsageStore;
  stripe: StripePorts | null;
  /** Catalog order matters: the first entry is the client-facing default.
   * Empty ⇒ the AI proxy answers 501 (no upstream key configured). */
  aiModels: readonly AiModel[];
  /** null + echoMagicToken=false ⇒ /v1/auth/request answers 501. No mocks. */
  magicLink: MagicLinkSender | null;
  /** Keyed by URL segment ("google", "github"). Unlisted providers 404. */
  oauthProviders: Record<string, OAuthProvider>;
  config: RelayConfig;
  now(): number;
  /** Upstream HTTP for the AI proxy — injectable so tests fake the LLM side. */
  aiFetch?: typeof fetch;
  /** Cloudflare's ctx.waitUntil — keeps post-stream accounting writes alive. */
  waitUntil?(promise: Promise<unknown>): void;
};
