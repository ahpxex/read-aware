/**
 * The relay's view of the connected account — email and blob storage used.
 * The local store only keeps the opaque account id (identity lives on the
 * relay), so the human-readable line in Data & Sync is fetched, once per
 * mount, and quietly absent while offline.
 */
import { useEffect, useState } from "react";
import { isTauri } from "../../../platform/environment";
import { syncRelayClient } from "../../../platform/sync/sync-scheduler";

export type SyncAccountInfo = { email: string; blobBytesUsed: number };

export function useSyncAccountInfo(connected: boolean): SyncAccountInfo | null {
  const [info, setInfo] = useState<SyncAccountInfo | null>(null);

  useEffect(() => {
    if (!connected || !isTauri()) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    void syncRelayClient()
      .account()
      .then((account) => {
        if (!cancelled) {
          setInfo({ email: account.email, blobBytesUsed: account.blobBytesUsed });
        }
      })
      .catch(() => {
        // Offline or expired session: the panel falls back to the account id.
      });
    return () => {
      cancelled = true;
    };
  }, [connected]);

  return info;
}
