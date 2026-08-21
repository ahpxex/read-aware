import type { SyncProfile } from "./sync-store";

/** Latest persisted proof that this account completed a relay operation. */
export function lastSuccessfulSyncAt(
  profile: Pick<SyncProfile, "lastPullAt" | "lastPushAt">,
): number | null {
  const timestamps = [profile.lastPullAt, profile.lastPushAt]
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter(Number.isFinite);
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}
