/**
 * The relay's seams. Every handler in router.ts runs against these interfaces;
 * the Worker entry (index.ts) binds them to D1 / Durable Objects / R2, and the
 * tests bind the SAME sql-backed cores to bun:sqlite — so what the suite
 * exercises is the real storage logic, not a parallel in-memory fiction.
 */
import type { SealedEventWire, SyncKeyMaterial } from "@read-aware/core";
import type { RelayLang } from "./i18n";

export type Account = {
  id: string;
  email: string;
  keys: SyncKeyMaterial | null;
  blobBytesUsed: number;
  createdAt: string;
};

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
  deleteSession(tokenHash: string): Promise<void>;
  /** Returns the new total. Clamped at zero (deletes never go negative). */
  adjustBlobBytes(id: string, delta: number): Promise<number>;
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
  /** Per single blob. */
  maxBlobBytes: number;
  /** Per account, total. THE bill guard — an open-source client base must
   * never be able to run the operator's R2 bill up (docs/sync-engine.md §11). */
  maxAccountBlobBytes: number;
  /** Per account, total events in the mailbox. Same guard for DO storage. */
  maxAccountEvents: number;
  /** Where a `client=web` OAuth finish is allowed to land (no open redirect). */
  webAppOrigin: string;
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
  // (MAX_ACCOUNT_BLOB_BYTES / MAX_ACCOUNT_EVENTS); a paid tier later turns
  // these into per-account values read off the account row.
  maxAccountBlobBytes: 50 * 1024 * 1024,
  maxAccountEvents: 50_000,
  webAppOrigin: "https://readaware.app",
};

export type RelayPorts = {
  accounts: AccountStore;
  mailboxFor(accountId: string): Mailbox;
  blobs: BlobStore;
  /** null + echoMagicToken=false ⇒ /v1/auth/request answers 501. No mocks. */
  magicLink: MagicLinkSender | null;
  /** Keyed by URL segment ("google", "github"). Unlisted providers 404. */
  oauthProviders: Record<string, OAuthProvider>;
  config: RelayConfig;
  now(): number;
};
