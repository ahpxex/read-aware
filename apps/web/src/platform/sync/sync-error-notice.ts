/**
 * Dismissal persistence for the header sync-error chip. Sync has no one-shot
 * action, so an error state is not a question the user answers — but an
 * unresolved failure must not become permanent furniture either. Dismissing
 * snoozes the chip for SYNC_ERROR_SNOOZE_MS regardless of how many retry
 * cycles fail in that window (a down relay fails every cycle; popping again
 * after each one is the exact annoyance this exists to fix). The Data & Sync
 * settings panel always shows the full diagnostic state, snooze or not.
 */
import { localKV } from "../local-store";

const DISMISSED_KV_KEY = "read-aware-sync-error-dismissed";

/** How long a dismissal keeps the error chip quiet. */
export const SYNC_ERROR_SNOOZE_MS = 24 * 60 * 60 * 1000;

export function readSyncErrorDismissedAt(): number | null {
  const raw = localKV.getItem(DISMISSED_KV_KEY);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Snooze the error chip; returns the recorded dismissal timestamp. */
export function dismissSyncErrorNotice(): number {
  const now = Date.now();
  localKV.setItem(DISMISSED_KV_KEY, String(now));
  return now;
}

/** True while the snooze window is open (pure — tests inject `now`). */
export function isSyncErrorSnoozedAt(
  dismissedAt: number | null,
  now: number = Date.now(),
): boolean {
  return dismissedAt !== null && now < dismissedAt + SYNC_ERROR_SNOOZE_MS;
}
