/**
 * The relay's seams. Every handler in router.ts runs against these interfaces;
 * the Worker entry (index.ts) binds them to D1 / Durable Objects / R2, and the
 * tests bind the SAME sql-backed cores to bun:sqlite — so what the suite
 * exercises is the real storage logic, not a parallel in-memory fiction.
 */
import type { SealedEventWire, SyncKeyMaterial } from "@read-aware/core";

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
  putSession(tokenHash: string, accountId: string, now: string): Promise<void>;
  sessionAccount(tokenHash: string): Promise<string | null>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Returns the new total. Clamped at zero (deletes never go negative). */
  adjustBlobBytes(id: string, delta: number): Promise<number>;
  deleteAccount(id: string): Promise<void>;
}

/** One account's numbered ciphertext mailbox. */
export interface Mailbox {
  /** Event id → server_seq; known ids return their existing seq. */
  append(events: SealedEventWire[]): Promise<Record<string, number>>;
  listAfter(after: number, limit: number): Promise<{ events: SealedEventWire[]; next: number }>;
  wipe(): Promise<void>;
}

export interface BlobStore {
  put(accountId: string, key: string, bytes: Uint8Array): Promise<void>;
  get(accountId: string, key: string): Promise<Uint8Array | null>;
  /** Returns the byte size freed (0 when the key was absent). */
  delete(accountId: string, key: string): Promise<number>;
  wipe(accountId: string): Promise<void>;
}

export interface MagicLinkSender {
  send(email: string, token: string): Promise<void>;
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
  /** Per account, total. */
  maxAccountBlobBytes: number;
};

export const DEFAULT_CONFIG: RelayConfig = {
  echoMagicToken: false,
  magicTokenTtlMs: 15 * 60 * 1000,
  maxEventBytes: 64 * 1024,
  maxBatch: 500,
  maxPullLimit: 500,
  maxBlobBytes: 256 * 1024 * 1024,
  maxAccountBlobBytes: 4 * 1024 * 1024 * 1024,
};

export type RelayPorts = {
  accounts: AccountStore;
  mailboxFor(accountId: string): Mailbox;
  blobs: BlobStore;
  /** null + echoMagicToken=false ⇒ /v1/auth/request answers 501. No mocks. */
  magicLink: MagicLinkSender | null;
  config: RelayConfig;
  now(): number;
};
