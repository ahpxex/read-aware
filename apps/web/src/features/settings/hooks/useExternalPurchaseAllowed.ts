/**
 * React face of `externalPurchaseAllowed` (platform/purchase-gate): starts
 * `false` on iOS so a forbidden Upgrade button never flashes while the
 * storefront resolves; every other platform starts (and stays) `true`.
 */
import { useEffect, useState } from "react";
import { isIOS, isTauri } from "../../../platform/environment";
import { externalPurchaseAllowed } from "../../../platform/purchase-gate";

export function useExternalPurchaseAllowed(): boolean {
  const [allowed, setAllowed] = useState(() => !isTauri() || !isIOS());
  useEffect(() => {
    if (allowed) return;
    let alive = true;
    void externalPurchaseAllowed().then((value) => {
      if (alive && value) setAllowed(true);
    });
    return () => {
      alive = false;
    };
  }, [allowed]);
  return allowed;
}
