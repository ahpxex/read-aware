import type { AccountStore } from "./ports";
import type { RateLimitStore } from "./rate-limit-store";

export const RATE_WINDOW_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Reclaim short-lived relay rows on a Cron Trigger, never on an attacker-owned
 * request path. All operations are idempotent; a retried schedule is harmless.
 */
export async function cleanupRelayStorage(
  accounts: Pick<AccountStore, "cleanupExpired">,
  rateLimits: Pick<RateLimitStore, "cleanup">,
  nowMs: number,
): Promise<void> {
  await Promise.all([
    accounts.cleanupExpired(nowMs),
    rateLimits.cleanup(nowMs - RATE_WINDOW_RETENTION_MS),
  ]);
}
