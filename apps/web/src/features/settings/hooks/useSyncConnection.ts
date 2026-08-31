/**
 * Sync-account state for the Data & Sync panel: the live scheduler status,
 * the persisted profile, and the connect / disconnect / sync-now actions.
 * All policy lives in platform/sync — this hook is the React adapter.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AppError, ERR_SYNC_TRANSPORT_UNAVAILABLE } from "@read-aware/core";
import { i18n } from "../../../i18n";
import { isTauri } from "../../../platform/environment";
import {
  establishEncryption,
  establishEncryptionWithStore,
  transportKeyMaterialStore,
  verifySignInToken,
  WrongPassphraseError,
  type SignInVerification,
} from "../../../platform/sync/connect";
import {
  getSyncConnectionBusy,
  runSyncConnectionOperation,
  subscribeSyncConnectionBusy,
  SyncConnectionBusyError,
} from "../../../platform/sync/connection-operation";
import { createRelayClient } from "../../../platform/sync/relay-client";
import {
  disconnectSync,
  getSyncStatusSnapshot,
  persistConnection,
  persistTransportConnection,
  relayBaseUrl,
  subscribeSyncStatus,
  syncNow,
  syncRelayClient,
} from "../../../platform/sync/sync-scheduler";
import { getSyncProfile, type SyncProfile } from "../../../platform/sync/sync-store";
import {
  findSyncTransport,
  listSyncTransports,
  onSyncTransportsChanged,
  parseTransportAccountId,
  type RegisteredSyncTransport,
} from "../../../platform/sync/transport-registry";

export { SyncConnectionBusyError, WrongPassphraseError };

/** "abc" | "…#abc" | "…/abc" → "abc": accept a pasted link or a bare token. */
export function parseMagicToken(input: string): string {
  const trimmed = input.trim();
  const afterHash = trimmed.includes("#") ? trimmed.slice(trimmed.indexOf("#") + 1) : trimmed;
  const afterSlash = afterHash.includes("/")
    ? afterHash.slice(afterHash.lastIndexOf("/") + 1)
    : afterHash;
  return afterSlash;
}

export const MIN_PASSPHRASE_LENGTH = 8;

export function useSyncConnection() {
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatusSnapshot);
  const busy = useSyncExternalStore(
    subscribeSyncConnectionBusy,
    getSyncConnectionBusy,
    getSyncConnectionBusy,
  );
  const [profile, setProfile] = useState<SyncProfile | null>(null);

  const reloadProfile = useCallback(async () => {
    if (!isTauri()) return;
    setProfile(await getSyncProfile());
  }, []);

  useEffect(() => {
    // A panel can mount while another instance's connect/disconnect command is
    // still holding the process-wide gate. Wait for that command to settle,
    // then load the profile it committed instead of keeping a stale snapshot.
    if (!busy) void reloadProfile();
  }, [busy, reloadProfile]);

  const connected = Boolean(profile?.syncEnabled && profile.remoteAccountId);
  /** Non-null when the connection is a plugin transport, not the relay. */
  const connectedTransport = connected
    ? parseTransportAccountId(profile?.remoteAccountId)
    : null;

  // Plugin-provided sync backends, live against plugin enable/disable.
  const [transports, setTransports] = useState<RegisteredSyncTransport[]>(() =>
    listSyncTransports(),
  );
  useEffect(
    () => onSyncTransportsChanged(() => setTransports(listSyncTransports())),
    [],
  );

  const sendLink = useCallback(
    (email: string): Promise<string | null> =>
      runSyncConnectionOperation(async () => {
        // The active app locale rides along so the email (and the landing page
        // its link opens) render in the user's language.
        const response = await syncRelayClient().requestMagicLink(email.trim(), i18n.language);
        return response.devToken ?? null;
      }),
    [],
  );

  /** Phase 1: burn the token, learn WHICH account it opened. The dialog
   *  shows `email` to the user before ever asking for a passphrase — a token
   *  can be delivered by a third party (deep link, paste), and the identity
   *  is the only thing that makes an attacker's account look like one. */
  const verifyToken = useCallback(
    (tokenInput: string): Promise<SignInVerification> =>
      runSyncConnectionOperation(() =>
        verifySignInToken(
          createRelayClient({ baseUrl: relayBaseUrl(), session: () => null }),
          parseMagicToken(tokenInput),
        ),
      ),
    [],
  );

  /** Phase 2: passphrase → master key → durable connection. Takes the
   *  verification phase 1 returned — there is no path to a passphrase that
   *  didn't pass through the email being shown. */
  const finishConnect = useCallback(
    (verification: SignInVerification, passphrase: string): Promise<void> =>
      runSyncConnectionOperation(async () => {
        // The fresh session lives in this closure until the whole connect
        // succeeds — establishEncryption's publishKeys must already carry it
        // (the regression that once burned a live sign-in token), while
        // nothing durable is written before persistConnection.
        const masterKeyBase64 = await establishEncryption(
          createRelayClient({
            baseUrl: relayBaseUrl(),
            session: () => verification.session,
          }),
          verification,
          passphrase,
        );
        await persistConnection({
          session: verification.session,
          accountId: verification.accountId,
          masterKeyBase64,
        });
        await reloadProfile();
      }),
    [reloadProfile],
  );

  const disconnect = useCallback(
    (): Promise<void> =>
      runSyncConnectionOperation(async () => {
        await disconnectSync();
        await reloadProfile();
      }),
    [reloadProfile],
  );

  const openTransport = async (ref: string) => {
    const transport = findSyncTransport(ref);
    if (!transport) {
      throw new AppError(
        ERR_SYNC_TRANSPORT_UNAVAILABLE,
        `sync transport "${ref}" is not registered`,
      );
    }
    return transport.open();
  };

  /** Reachability + credential check against the transport's CURRENT
   *  settings, reporting whether the remote already holds key material —
   *  which decides the passphrase step's wording (set vs. re-enter). */
  const probeTransport = useCallback(
    (ref: string): Promise<{ hasKeys: boolean }> =>
      runSyncConnectionOperation(async () => {
        const session = await openTransport(ref);
        await session.probe();
        const keys = await transportKeyMaterialStore(session).load();
        return { hasKeys: keys !== null };
      }),
    [],
  );

  /** The transport counterpart of `finishConnect`: passphrase ritual against
   *  the remote's key-material object, then a durable profile binding. */
  const connectTransport = useCallback(
    (ref: string, passphrase: string): Promise<void> =>
      runSyncConnectionOperation(async () => {
        const session = await openTransport(ref);
        const masterKeyBase64 = await establishEncryptionWithStore(
          transportKeyMaterialStore(session),
          passphrase,
        );
        await persistTransportConnection({
          ref,
          endpointId: session.endpointId,
          masterKeyBase64,
        });
        await reloadProfile();
      }),
    [reloadProfile],
  );

  const requestSyncNow = useCallback(async (): Promise<void> => {
    await syncNow();
  }, []);

  return {
    status,
    profile,
    connected,
    connectedTransport,
    transports,
    busy,
    sendLink,
    verifyToken,
    finishConnect,
    probeTransport,
    connectTransport,
    disconnect,
    requestSyncNow,
  };
}
