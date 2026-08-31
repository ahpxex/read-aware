/**
 * The account-connect flow (docs/sync-engine.md §5, §9), in TWO phases with a
 * user-facing boundary between them:
 *
 *  1. `verifySignInToken` — redeem the one-time token. Returns WHICH account
 *     it opened (`email`) alongside the session. Burning the token here is
 *     fine: the sign-in email/OAuth page is still valid to re-request.
 *  2. `establishEncryption` — passphrase → master key, verified against (or
 *     published as) the account's key material.
 *
 * The boundary is the login-CSRF defense: a sign-in token can be delivered by
 * a THIRD PARTY (a deep link from any web page, a pasted "code"), so the UI
 * must show the account email between the phases — before, never after, the
 * user is asked for the encryption passphrase. A token for an attacker's
 * account must not be connectable while looking like "just finish signing
 * in": once the passphrase lands, this device's whole library adopts that
 * account. `establishEncryption` therefore takes the verification from phase
 * 1 as a parameter — there is no way to call it without having had the email
 * in hand.
 *
 * Pure orchestration over an injected relay client and KDF, so the whole flow
 * — including the publish race between two first devices — runs under bun:test.
 */
import type { SyncKeyMaterial } from "@read-aware/core";
import type { PluginSyncTransportSession } from "@read-aware/plugin-types";
import {
  DEFAULT_KDF_PARAMS,
  deriveMasterKey,
  makeKeyCheck,
  newKdfSalt,
  toBase64,
  verifyKeyCheck,
  type KdfParams,
} from "../sync-envelope";
import type { RelayClient } from "./relay-client";

/** Phase 1's result — phase 2's contract. */
export type SignInVerification = {
  session: string;
  accountId: string;
  /** The account the token opened. The UI shows this before any passphrase. */
  email: string;
  /** null on an account no device has published key material for yet. */
  keys: SyncKeyMaterial | null;
};

/** Thrown when the typed passphrase does not open this account's data. */
export class WrongPassphraseError extends Error {
  constructor() {
    super("the passphrase does not match this account's key check");
    this.name = "WrongPassphraseError";
  }
}

/** A 2xx response that cannot safely cross the user-visible identity gate. */
export class InvalidSignInResponseError extends Error {
  constructor() {
    super("sync: sign-in verification response is missing a valid account identity");
    this.name = "InvalidSignInResponseError";
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Keep this aligned with the relay's account identifier contract, with one
// additional display-safety fence: format/control code points can make a value
// look blank or reorder what the confirmation gate speaks and paints.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_HIDDEN_CODE_POINT = /[\p{Cc}\p{Default_Ignorable_Code_Point}]/u;

function isEmailIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    EMAIL_SHAPE.test(value) &&
    !EMAIL_HIDDEN_CODE_POINT.test(value)
  );
}

function isKeyMaterial(value: unknown): value is SyncKeyMaterial {
  if (typeof value !== "object" || value === null) return false;
  const keys = value as Record<string, unknown>;
  if (!isNonEmptyString(keys.kdfSalt) || !isNonEmptyString(keys.keyCheck)) return false;
  if (typeof keys.kdfParams !== "object" || keys.kdfParams === null) return false;
  const params = keys.kdfParams as Record<string, unknown>;
  return (
    params.algo === "argon2id" &&
    typeof params.t === "number" &&
    Number.isFinite(params.t) &&
    params.t > 0 &&
    typeof params.m === "number" &&
    Number.isFinite(params.m) &&
    params.m > 0 &&
    typeof params.p === "number" &&
    Number.isFinite(params.p) &&
    params.p > 0
  );
}

function isSignInVerification(value: unknown): value is SignInVerification {
  if (typeof value !== "object" || value === null) return false;
  const response = value as Record<string, unknown>;
  return (
    isNonEmptyString(response.session) &&
    isNonEmptyString(response.accountId) &&
    isEmailIdentity(response.email) &&
    (response.keys === null || isKeyMaterial(response.keys))
  );
}

/** Injectable for tests (Argon2id at production cost is deliberately slow). */
export type DeriveFn = (passphrase: string, salt: string, params: KdfParams) => Uint8Array;

/**
 * Phase 1: burn the one-time token, learn the account. The caller's relay
 * needs no session — this is the endpoint that issues one. Hold the result
 * (its `session` included) until the user has confirmed the email; it is the
 * credential phase 2 rides on.
 */
export async function verifySignInToken(
  relay: Pick<RelayClient, "verifyMagicLink">,
  token: string,
): Promise<SignInVerification> {
  // The HTTP client is typed, but JSON is still untrusted at runtime. Version
  // skew with an older relay used to produce `email: undefined`, rendering a
  // blank identity card while leaving phase 2 enabled — exactly the boundary
  // this flow exists to enforce. A malformed 2xx therefore fails closed.
  let response: unknown;
  try {
    response = await relay.verifyMagicLink(token);
  } catch (error) {
    // `verifyMagicLink` parses a 2xx JSON body. Invalid JSON is a malformed
    // success response, not a network failure; the relay may already have
    // consumed the one-time token, so the UI must not promise a retry.
    if (error instanceof SyntaxError) throw new InvalidSignInResponseError();
    throw error;
  }
  if (!isSignInVerification(response)) throw new InvalidSignInResponseError();
  return response;
}

/**
 * Where an account's key material lives, seen from the passphrase ritual:
 * what is already published, and a publish that loses first-writer-wins races
 * explicitly. The relay implements this over its keys endpoint; a plugin
 * transport implements it over a create-only meta object on dumb storage.
 */
export type KeyMaterialStore = {
  load(): Promise<SyncKeyMaterial | null>;
  publish(
    keys: SyncKeyMaterial,
  ): Promise<{ outcome: "set" } | { outcome: "conflict"; keys: SyncKeyMaterial | null }>;
};

/**
 * The passphrase ritual against any key-material store.
 *
 * A later device (the store has material) verifies, never mints. The first
 * device mints salt + key + check and publishes them; if it loses the publish
 * race, the other device's material is canonical and the passphrase must open
 * THAT or the connect fails.
 */
export async function establishEncryptionWithStore(
  store: KeyMaterialStore,
  passphrase: string,
  options: { derive?: DeriveFn; kdfParams?: KdfParams } = {},
): Promise<string> {
  const derive = options.derive ?? deriveMasterKey;
  const verifyAgainst = (material: SyncKeyMaterial): Uint8Array => {
    const key = derive(passphrase, material.kdfSalt, material.kdfParams);
    if (!verifyKeyCheck(key, material.keyCheck)) throw new WrongPassphraseError();
    return key;
  };

  const existing = await store.load();
  if (existing) return toBase64(verifyAgainst(existing));

  const params = options.kdfParams ?? DEFAULT_KDF_PARAMS;
  const salt = newKdfSalt();
  const key = derive(passphrase, salt, params);
  const published = await store.publish({
    kdfSalt: salt,
    kdfParams: params,
    keyCheck: makeKeyCheck(key),
  });
  if (published.outcome === "conflict") {
    // Another device published first while we were deriving. Their material is
    // canonical; our passphrase must open THEIRS or the connect fails.
    if (!published.keys) throw new Error("sync: key conflict without canonical material");
    return toBase64(verifyAgainst(published.keys));
  }
  return toBase64(key);
}

/**
 * Phase 2: passphrase → master key. `relay` MUST already serve
 * `verification.session` (its 409-conflict path calls the authenticated
 * account endpoint); wire the client with the session provider before
 * calling — the regression this once caused burned a live sign-in token.
 */
export async function establishEncryption(
  relay: Pick<RelayClient, "publishKeys">,
  verification: SignInVerification,
  passphrase: string,
  options: { derive?: DeriveFn; kdfParams?: KdfParams } = {},
): Promise<string> {
  return establishEncryptionWithStore(
    {
      // Phase 1 already fetched the account's material; re-asking the relay
      // here would burn a request for the same answer.
      load: async () => verification.keys,
      // Called on the relay object (not a detached reference): publishKeys
      // uses `this.account()` on its 409 path.
      publish: (keys) => relay.publishKeys(keys),
    },
    passphrase,
    options,
  );
}

/** The meta object name a transport's key material lives under. */
export const TRANSPORT_KEYS_META = "keys";

/**
 * Key material on a plugin transport's dumb storage: one JSON meta object,
 * created with first-writer-wins (`putMetaIfAbsent`), immutable afterwards —
 * the same contract the relay's keys endpoint enforces server-side.
 */
export function transportKeyMaterialStore(
  session: Pick<PluginSyncTransportSession, "getMeta" | "putMetaIfAbsent">,
): KeyMaterialStore {
  const load = async (): Promise<SyncKeyMaterial | null> => {
    const bytes = await session.getMeta(TRANSPORT_KEYS_META);
    if (!bytes) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error("sync: the transport's key material object is not valid JSON");
    }
    if (!isKeyMaterial(parsed)) {
      throw new Error("sync: the transport's key material object has an invalid shape");
    }
    return parsed;
  };
  return {
    load,
    async publish(keys) {
      const outcome = await session.putMetaIfAbsent(
        TRANSPORT_KEYS_META,
        new TextEncoder().encode(JSON.stringify(keys)),
      );
      if (outcome === "stored") return { outcome: "set" };
      // Lost the first-writer race (or material predates this connect):
      // whatever is stored is canonical.
      return { outcome: "conflict", keys: await load() };
    },
  };
}
