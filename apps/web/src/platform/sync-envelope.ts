/**
 * E2E envelope for the sync relay (docs/sync-engine.md §6).
 *
 * The relay stores ciphertext only. The encrypted envelope covers EVERYTHING
 * that describes behavior — event type, aggregate, payload, timestamps —
 * because plaintext event types alone would hand the relay a complete timeline
 * of reading activity (docs/data-model.md §9). The clear fields are exactly
 * what routing needs: the event `id` (idempotency key) and the HLC stamp
 * (merge ordering, and the receiver must advance its clock BEFORE decrypting).
 *
 * The AAD binds each ciphertext to its clear identity, so a relay (or an
 * attacker holding relay data) cannot graft one event's ciphertext onto
 * another's id/stamp and replay it under a different position in the log.
 *
 * Pure functions over bytes — no IPC, no storage, no network — so every
 * property is testable directly. Key material never leaves the caller.
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { argon2id } from "@noble/hashes/argon2.js";
import type { HlcStamp } from "@read-aware/core";

/** The full event wire shape (mirrors Rust `EventRow` camelCase serde). */
export type PlainEvent = {
  id: string;
  type: string;
  hlc: HlcStamp;
  schemaVersion?: number;
  aggregateType?: string;
  aggregateId?: string;
  actorId?: string;
  origin?: string;
  createdAt?: string;
  payload: unknown;
};

/** What actually crosses the wire — see the module header for why so little. */
export type SealedEvent = {
  id: string;
  hlc: HlcStamp;
  /** Envelope version: room to rotate algorithms/keys without a flag day. */
  v: 1;
  /** 24-byte XChaCha nonce, base64. Fresh per seal; never reused. */
  nonce: string;
  ciphertext: string;
};

const ENVELOPE_VERSION = 1 as const;
const NONCE_BYTES = 24;

const utf8 = (s: string) => new TextEncoder().encode(s);
const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b);

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** The identity a sealed event is bound to; part of every event AAD. */
function eventAad(id: string, hlc: HlcStamp): Uint8Array {
  return utf8(
    `ra-event:v${ENVELOPE_VERSION}:${id}:${hlc.wallMs}:${hlc.counter}:${hlc.deviceId}`,
  );
}

/** Encrypt one event for the relay. */
export function sealEvent(key: Uint8Array, event: PlainEvent): SealedEvent {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = xchacha20poly1305(key, nonce, eventAad(event.id, event.hlc));
  return {
    id: event.id,
    hlc: event.hlc,
    v: ENVELOPE_VERSION,
    nonce: toBase64(nonce),
    ciphertext: toBase64(cipher.encrypt(utf8(JSON.stringify(event)))),
  };
}

/**
 * Decrypt one pulled event. Throws on tampering, on a ciphertext grafted onto
 * a different id/stamp (AAD mismatch), and on an envelope whose inner identity
 * disagrees with its clear routing fields — a seal this module never produced.
 */
export function openEvent(key: Uint8Array, sealed: SealedEvent): PlainEvent {
  if (sealed.v !== ENVELOPE_VERSION) {
    throw new Error(`sync envelope: unsupported event envelope version ${sealed.v}`);
  }
  const cipher = xchacha20poly1305(
    key,
    fromBase64(sealed.nonce),
    eventAad(sealed.id, sealed.hlc),
  );
  const event = JSON.parse(fromUtf8(cipher.decrypt(fromBase64(sealed.ciphertext)))) as PlainEvent;
  if (
    event.id !== sealed.id ||
    event.hlc.wallMs !== sealed.hlc.wallMs ||
    event.hlc.counter !== sealed.hlc.counter ||
    event.hlc.deviceId !== sealed.hlc.deviceId
  ) {
    throw new Error("sync envelope: sealed identity does not match its contents");
  }
  return event;
}

// ─── Blobs ───────────────────────────────────────────────────────────────────
//
// Wire format: [version:1][nonce:24][ciphertext+tag]. Whole-blob AEAD — a book
// file is already a single in-memory buffer on both ends of the transfer, so
// chunked streaming encryption would buy nothing today; the version byte is
// where a chunked format would slot in if file sizes ever demand it. The AAD
// binds the ciphertext to its blob key, so relay data can't be served back
// under another key.

export function sealBlob(key: Uint8Array, blobKey: string, bytes: Uint8Array): Uint8Array {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = xchacha20poly1305(key, nonce, utf8(`ra-blob:v1:${blobKey}`));
  const sealed = cipher.encrypt(bytes);
  const out = new Uint8Array(1 + NONCE_BYTES + sealed.length);
  out[0] = ENVELOPE_VERSION;
  out.set(nonce, 1);
  out.set(sealed, 1 + NONCE_BYTES);
  return out;
}

export function openBlob(key: Uint8Array, blobKey: string, wire: Uint8Array): Uint8Array {
  if (wire.length < 1 + NONCE_BYTES || wire[0] !== ENVELOPE_VERSION) {
    throw new Error("sync envelope: unrecognized blob envelope");
  }
  const nonce = wire.subarray(1, 1 + NONCE_BYTES);
  const cipher = xchacha20poly1305(key, nonce, utf8(`ra-blob:v1:${blobKey}`));
  return cipher.decrypt(wire.subarray(1 + NONCE_BYTES));
}

// ─── Passphrase → master key (Argon2id) ──────────────────────────────────────

/**
 * KDF parameters travel with the account (the relay stores them next to the
 * salt — neither is secret) so every device derives the same key and old
 * accounts keep working when the defaults move.
 */
export type KdfParams = {
  algo: "argon2id";
  /** Iterations. */
  t: number;
  /** Memory cost in KiB. */
  m: number;
  /** Parallelism. */
  p: number;
};

/** OWASP's recommended Argon2id cost (19 MiB / t=2 / p=1), 2026 guidance. */
export const DEFAULT_KDF_PARAMS: KdfParams = { algo: "argon2id", t: 2, m: 19_456, p: 1 };

/** A fresh random KDF salt, minted once per account, base64. */
export function newKdfSalt(): string {
  return toBase64(randomBytes(16));
}

/**
 * Derive the 32-byte E2E master key from the user's passphrase. Deliberately
 * slow (memory-hard) — this is the offline-bruteforce defence; passphrase
 * STRENGTH is enforced by the connect UI, not here. NFKC so the same
 * passphrase typed on different platforms/IMEs derives the same key.
 */
export function deriveMasterKey(
  passphrase: string,
  saltBase64: string,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Uint8Array {
  if (params.algo !== "argon2id") {
    throw new Error(`sync envelope: unsupported kdf ${String(params.algo)}`);
  }
  return argon2id(utf8(passphrase.normalize("NFKC")), fromBase64(saltBase64), {
    t: params.t,
    m: params.m,
    p: params.p,
    dkLen: 32,
  });
}

// ─── Key check ───────────────────────────────────────────────────────────────
//
// A tiny sealed constant published to the relay next to the salt. A new device
// verifies the typed passphrase against it BEFORE pulling the whole log —
// turning "wrong passphrase" from a thousand decrypt failures into one crisp
// prompt. Reveals nothing: it is a ciphertext under the same AEAD as the data.

const KEY_CHECK_PLAINTEXT = "read-aware-key-check";

export function makeKeyCheck(key: Uint8Array): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = xchacha20poly1305(key, nonce, utf8("ra-keycheck:v1"));
  const sealed = cipher.encrypt(utf8(KEY_CHECK_PLAINTEXT));
  const out = new Uint8Array(NONCE_BYTES + sealed.length);
  out.set(nonce, 0);
  out.set(sealed, NONCE_BYTES);
  return `v1:${toBase64(out)}`;
}

export function verifyKeyCheck(key: Uint8Array, check: string): boolean {
  if (!check.startsWith("v1:")) return false;
  try {
    const wire = fromBase64(check.slice(3));
    const cipher = xchacha20poly1305(key, wire.subarray(0, NONCE_BYTES), utf8("ra-keycheck:v1"));
    return fromUtf8(cipher.decrypt(wire.subarray(NONCE_BYTES))) === KEY_CHECK_PLAINTEXT;
  } catch {
    return false;
  }
}
