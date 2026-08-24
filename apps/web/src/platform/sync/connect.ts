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
  const { session, accountId, email, keys } = await relay.verifyMagicLink(token);
  return { session, accountId, email, keys };
}

/**
 * Phase 2: passphrase → master key. `relay` MUST already serve
 * `verification.session` (its 409-conflict path calls the authenticated
 * account endpoint); wire the client with the session provider before
 * calling — the regression this once caused burned a live sign-in token.
 *
 * A later device (the account has key material) verifies, never mints. The
 * first device mints salt + key + check and publishes them; if it loses the
 * publish race (409), the other device's material is canonical and the
 * passphrase must open THAT or the connect fails.
 */
export async function establishEncryption(
  relay: Pick<RelayClient, "publishKeys">,
  verification: SignInVerification,
  passphrase: string,
  options: { derive?: DeriveFn; kdfParams?: KdfParams } = {},
): Promise<string> {
  const derive = options.derive ?? deriveMasterKey;
  const verifyAgainst = (material: SyncKeyMaterial): Uint8Array => {
    const key = derive(passphrase, material.kdfSalt, material.kdfParams);
    if (!verifyKeyCheck(key, material.keyCheck)) throw new WrongPassphraseError();
    return key;
  };

  if (verification.keys) {
    return toBase64(verifyAgainst(verification.keys));
  }

  const params = options.kdfParams ?? DEFAULT_KDF_PARAMS;
  const salt = newKdfSalt();
  const key = derive(passphrase, salt, params);
  // Called on the relay object (not a detached reference): publishKeys uses
  // `this.account()` on its 409 path.
  const published = await relay.publishKeys({
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
