/**
 * The account-connect flow (docs/sync-engine.md §5, §9): redeem the magic
 * token, derive the master key from the passphrase, and either verify it
 * against the account's published key-check (later devices) or publish fresh
 * key material (the first device). Pure orchestration over an injected relay
 * client and KDF, so the whole flow — including the publish race between two
 * first devices — runs under bun:test.
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

export type ConnectResult = {
  session: string;
  accountId: string;
  /** base64 — callers seal it into the secret store, never SQLite. */
  masterKeyBase64: string;
};

/** Thrown when the typed passphrase does not open this account's data. */
export class WrongPassphraseError extends Error {
  constructor() {
    super("the passphrase does not match this account's key check");
    this.name = "WrongPassphraseError";
  }
}

export type ConnectOptions = {
  relay: Pick<RelayClient, "verifyMagicLink" | "publishKeys">;
  token: string;
  passphrase: string;
  /**
   * Called with the fresh session token IMMEDIATELY after verification, BEFORE
   * `publishKeys` fires — the relay client's session provider must start
   * serving it here, or the first device's key publish goes out unauthenticated
   * and 401s (with the single-use sign-in token already burned).
   */
  onSession?: (session: string) => void;
  /** Injectable for tests (Argon2id at production cost is deliberately slow). */
  derive?: (passphrase: string, salt: string, params: KdfParams) => Uint8Array;
  kdfParams?: KdfParams;
};

/**
 * Note the session-before-key order: `verifyMagicLink` must run first because
 * `publishKeys` needs the session — but the caller should treat the result as
 * all-or-nothing and store nothing durable until this resolves.
 */
export async function connectAccount(options: ConnectOptions): Promise<ConnectResult> {
  const derive = options.derive ?? deriveMasterKey;
  const { session, accountId, keys } = await options.relay.verifyMagicLink(options.token);
  options.onSession?.(session);

  const verifyAgainst = (material: SyncKeyMaterial): Uint8Array => {
    const key = derive(options.passphrase, material.kdfSalt, material.kdfParams);
    if (!verifyKeyCheck(key, material.keyCheck)) throw new WrongPassphraseError();
    return key;
  };

  if (keys) {
    // A later device: the account already has key material — verify, never mint.
    return { session, accountId, masterKeyBase64: toBase64(verifyAgainst(keys)) };
  }

  // The first device mints salt + key + check and publishes them.
  const params = options.kdfParams ?? DEFAULT_KDF_PARAMS;
  const salt = newKdfSalt();
  const key = derive(options.passphrase, salt, params);
  // Called on the relay object (not a detached reference): publishKeys uses
  // `this.account()` on its 409 path.
  const published = await options.relay.publishKeys({
    kdfSalt: salt,
    kdfParams: params,
    keyCheck: makeKeyCheck(key),
  });
  if (published.outcome === "conflict") {
    // Another device published first while we were deriving. Their material is
    // canonical; our passphrase must open THEIRS or the connect fails.
    if (!published.keys) throw new Error("sync: key conflict without canonical material");
    return { session, accountId, masterKeyBase64: toBase64(verifyAgainst(published.keys)) };
  }
  return { session, accountId, masterKeyBase64: toBase64(key) };
}
