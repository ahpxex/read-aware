/**
 * Sync relay wire protocol — the contract between the desktop client
 * (apps/web/src/platform/sync*) and the relay Worker (apps/relay).
 *
 * The relay is a numbered ciphertext mailbox (docs/sync-engine.md §3): it
 * stores sealed envelopes, assigns each a per-account monotonically increasing
 * `server_seq`, and feeds them back in that order. Nothing here describes
 * event CONTENT — that is the point.
 */
import type { HlcStamp } from "./events";

/** Argon2id cost parameters; stored next to the salt, neither is secret. */
export type SyncKdfParams = {
  algo: "argon2id";
  /** Iterations. */
  t: number;
  /** Memory cost in KiB. */
  m: number;
  /** Parallelism. */
  p: number;
};

/**
 * One sealed event as it crosses the wire. The clear fields are exactly what
 * routing needs: `id` for idempotent dedup, `hlc` for merge ordering (and the
 * receiver advances its clock from it BEFORE decrypting). Everything that
 * describes behavior lives inside `ciphertext`.
 */
export type SealedEventWire = {
  id: string;
  hlc: HlcStamp;
  /** Envelope version — room to rotate algorithms/keys without a flag day. */
  v: 1;
  /** 24-byte XChaCha20 nonce, base64. */
  nonce: string;
  ciphertext: string;
};

/**
 * The account's published key material: enough for a new device to derive and
 * verify the master key from the typed passphrase, nothing an attacker can use
 * without it. Set once by the first device; immutable afterwards (changing the
 * passphrase is a re-encrypt-everything operation, v2).
 */
export type SyncKeyMaterial = {
  /** Argon2id salt, base64. */
  kdfSalt: string;
  kdfParams: SyncKdfParams;
  /** Sealed constant to verify a passphrase BEFORE pulling the whole log. */
  keyCheck: string;
};

// ── /v1/auth ─────────────────────────────────────────────────────────────────

/** `lang` is the requesting device's app locale — the email renders in it. */
export type AuthRequestBody = { email: string; lang?: string };
/** `devToken` is present only when the relay runs in echo mode (local dev). */
export type AuthRequestResponse = { ok: true; devToken?: string };

export type AuthVerifyBody = { token: string };
export type AuthVerifyResponse = {
  session: string;
  accountId: string;
  /** null until the first device publishes key material. */
  keys: SyncKeyMaterial | null;
};

// ── /v1/account ──────────────────────────────────────────────────────────────

/**
 * Account tiers: `free` / `pro` / `max` are the public ladder, `staff` is
 * internal-only. The tier decides quotas and nothing else — the relay stores
 * ciphertext either way. Tier → quota mapping lives server-side
 * (apps/relay/src/ports.ts); the wire carries the resolved numbers in
 * `AccountResponse.limits` so the client never hardcodes them.
 */
export type SyncTier = "free" | "pro" | "max" | "staff";

/** Resolved quota numbers for the account's current tier; null = unlimited. */
export type SyncTierLimits = {
  /** Per single blob upload. */
  maxBlobBytes: number | null;
  /** Per account, total blob bytes. */
  maxAccountBlobBytes: number | null;
  /** Per account, total events in the mailbox. */
  maxAccountEvents: number | null;
};

export type AccountResponse = {
  accountId: string;
  email: string;
  keys: SyncKeyMaterial | null;
  blobBytesUsed: number;
  /** Already resolved: an expired paid tier reads as "free" here. */
  tier: SyncTier;
  /** When the paid tier lapses (ms epoch); null = never / not applicable. */
  tierExpiresAtMs: number | null;
  eventsUsed: number;
  limits: SyncTierLimits;
};

// ── /v1/events ───────────────────────────────────────────────────────────────

export type PushEventsBody = { events: SealedEventWire[] };
/** Event id → assigned server_seq. Re-pushing a known id returns its old seq. */
export type PushEventsResponse = { seqs: Record<string, number> };

export type PullEventsResponse = {
  events: SealedEventWire[];
  /**
   * Pull cursor for the next request (`?after=<next>`). When `events` comes
   * back shorter than the requested limit, the feed is drained.
   */
  next: number;
};

/** Uniform error body for every non-2xx response. */
export type RelayErrorResponse = { error: string };
