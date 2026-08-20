/**
 * readaware://billing/success — the relay's billing return page fires this
 * deep link after an app-initiated checkout pays, landing the buyer back in
 * the app they started from. Same shape as sync-login-link: pure parsing,
 * plus a subscription covering both the cold-start URL and links arriving
 * while the app runs.
 */
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";

const BILLING_SUCCESS_PATTERN = /^readaware:\/\/billing\/success\/?(?:[?#]|$)/i;

export function isBillingSuccessUrl(url: string): boolean {
  return BILLING_SUCCESS_PATTERN.test(url.trim());
}

function hasBillingSuccess(urls: readonly string[] | null | undefined): boolean {
  return (urls ?? []).some(isBillingSuccessUrl);
}

/**
 * Deliver every billing-success arrival. Like the sign-in link, delivery is
 * at-least-once (startup snapshot and open event can both carry the URL) —
 * the callback must be idempotent.
 */
export async function subscribeBillingReturns(onReturn: () => void): Promise<() => void> {
  const unlisten = await onOpenUrl((urls) => {
    if (hasBillingSuccess(urls)) onReturn();
  });
  // AFTER subscribing, drain the startup URL — the other order can drop a
  // link that lands between the two calls.
  if (hasBillingSuccess(await getCurrent())) onReturn();
  return unlisten;
}
