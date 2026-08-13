/**
 * Sync-account state for the Data & Sync panel: the live scheduler status,
 * the persisted profile, and the connect / disconnect / sync-now actions.
 * All policy lives in platform/sync — this hook is the React adapter.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { isTauri } from "../../../platform/environment";
import { connectAccount, WrongPassphraseError } from "../../../platform/sync/connect";
import {
  disconnectSync,
  getSyncStatusSnapshot,
  persistConnection,
  subscribeSyncStatus,
  syncNow,
  syncRelayClient,
} from "../../../platform/sync/sync-scheduler";
import { getSyncProfile, type SyncProfile } from "../../../platform/sync/sync-store";

export { WrongPassphraseError };

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
  const [profile, setProfile] = useState<SyncProfile | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadProfile = useCallback(async () => {
    if (!isTauri()) return;
    setProfile(await getSyncProfile());
  }, []);

  useEffect(() => {
    void reloadProfile();
  }, [reloadProfile]);

  const connected = Boolean(profile?.syncEnabled && profile.remoteAccountId);

  const sendLink = useCallback(async (email: string): Promise<string | null> => {
    setBusy(true);
    try {
      const response = await syncRelayClient().requestMagicLink(email.trim());
      return response.devToken ?? null;
    } finally {
      setBusy(false);
    }
  }, []);

  const connect = useCallback(
    async (tokenInput: string, passphrase: string): Promise<void> => {
      setBusy(true);
      try {
        const result = await connectAccount({
          relay: syncRelayClient(),
          token: parseMagicToken(tokenInput),
          passphrase,
        });
        await persistConnection(result);
        await reloadProfile();
      } finally {
        setBusy(false);
      }
    },
    [reloadProfile],
  );

  const disconnect = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      await disconnectSync();
      await reloadProfile();
    } finally {
      setBusy(false);
    }
  }, [reloadProfile]);

  const requestSyncNow = useCallback(async (): Promise<void> => {
    await syncNow();
  }, []);

  return { status, profile, connected, busy, sendLink, connect, disconnect, requestSyncNow };
}
