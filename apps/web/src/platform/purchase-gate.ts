/**
 * Whether this build may surface external purchase links (the landing's
 * Stripe checkout, the billing portal).
 *
 * Apple's guideline 3.1.1 forbids steering users to purchases outside the
 * App Store — except on the United States storefront, where the 2025
 * Epic v. Apple injunction legalized external purchase links. So iOS asks
 * the signed-in App Store account's storefront (`storefront.rs`) and only
 * the US answer unlocks the purchase surfaces; every other platform sells
 * freely. No account / unknown storefront counts as "not US": showing a
 * forbidden button risks the whole release, hiding one loses a sale.
 */
import { isIOS, isTauri } from "./environment";
import { invoke } from "./ipc";
import { createLogger } from "./logger";

const log = createLogger("purchase-gate");

let cached: Promise<boolean> | null = null;

export function externalPurchaseAllowed(): Promise<boolean> {
  if (!isTauri() || !isIOS()) return Promise.resolve(true);
  // The storefront belongs to the signed-in App Store account and does not
  // change mid-session — one IPC round-trip per launch.
  cached ??= invoke<string | null>("app_store_storefront")
    .then((code) => code?.toUpperCase() === "USA")
    .catch((error: unknown) => {
      log.warn("storefront lookup failed; hiding purchase surfaces", error);
      return false;
    });
  return cached;
}
