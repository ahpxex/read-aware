/**
 * Dismissal persistence for the "sign in again" notice that appears when the
 * relay rejects the stored session (sync status `unauthenticated`). Dismissing
 * silences the notice for the remainder of that dead session's epoch; a fresh
 * connect or an explicit disconnect clears the flag, so a future session that
 * dies prompts again. Settings → Data & Sync always shows the real state
 * regardless of this flag.
 */
import { localKV } from "../local-store";

const DISMISSED_KV_KEY = "read-aware-sync-reauth-dismissed";

export function isReauthNoticeDismissed(): boolean {
  return localKV.getItem(DISMISSED_KV_KEY) !== null;
}

export function dismissReauthNotice(): void {
  localKV.setItem(DISMISSED_KV_KEY, "1");
}

export function clearReauthNoticeDismissal(): void {
  localKV.removeItem(DISMISSED_KV_KEY);
}
