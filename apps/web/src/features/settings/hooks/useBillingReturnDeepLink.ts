/**
 * App-level listener for the billing return deep link: when
 * readaware://billing/success lands (the relay's post-checkout page fired
 * it), steer the UI to Settings → Data & Sync — the panel fetches the
 * account fresh on mount, so the new plan shows without any sign-in step.
 * Mounted once in App; a no-op outside the Tauri shell.
 */
import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { isTauri } from "../../../platform/environment";
import { createLogger } from "../../../platform/logger";
import { subscribeBillingReturns } from "../../../platform/sync/billing-return-link";
import { settingsOpenAtom, settingsSectionRequestAtom } from "../../../state/ui";

const log = createLogger("sync");

export function useBillingReturnDeepLink(): void {
  const setSettingsOpen = useSetAtom(settingsOpenAtom);
  const setSectionRequest = useSetAtom(settingsSectionRequestAtom);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let dispose: (() => void) | null = null;

    // Delivery is at-least-once; opening an already-open panel is idempotent.
    subscribeBillingReturns(() => {
      if (disposed) return;
      setSectionRequest("dataSync");
      setSettingsOpen(true);
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else dispose = unlisten;
      })
      .catch((error) => {
        // Worst case the buyer opens settings themselves; the tier is already
        // fulfilled server-side by the webhook.
        log.error("billing deep-link subscription failed", error);
      });

    return () => {
      disposed = true;
      dispose?.();
    };
  }, [setSettingsOpen, setSectionRequest]);
}
