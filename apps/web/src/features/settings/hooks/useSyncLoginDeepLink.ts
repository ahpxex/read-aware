/**
 * App-level listener for sync sign-in deep links: when a
 * readaware://sync/login/<token> lands (cold start or while running), stash
 * the token and steer the UI to Settings → Data & Sync, where the connect
 * dialog picks it up and jumps straight to the passphrase step. Mounted once
 * in App; a no-op outside the Tauri shell.
 */
import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { isTauri } from "../../../platform/environment";
import { createLogger } from "../../../platform/logger";
import { subscribeSyncLoginTokens } from "../../../platform/sync/sync-login-link";
import {
  settingsOpenAtom,
  settingsSectionRequestAtom,
  syncLoginTokenAtom,
} from "../../../state/ui";

const log = createLogger("sync");

export function useSyncLoginDeepLink(): void {
  const setSettingsOpen = useSetAtom(settingsOpenAtom);
  const setSectionRequest = useSetAtom(settingsSectionRequestAtom);
  const setSyncLoginToken = useSetAtom(syncLoginTokenAtom);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let dispose: (() => void) | null = null;
    // Delivery is at-least-once (a cold-start URL can also replay through the
    // open event) — consume each token exactly once.
    const seen = new Set<string>();

    subscribeSyncLoginTokens((token) => {
      if (disposed || seen.has(token)) return;
      seen.add(token);
      setSyncLoginToken(token);
      setSectionRequest("dataSync");
      setSettingsOpen(true);
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else dispose = unlisten;
      })
      .catch((error) => {
        // Sign-in links degrade to paste-the-token; the app keeps working.
        log.error("deep-link subscription failed", error);
      });

    return () => {
      disposed = true;
      dispose?.();
    };
  }, [setSettingsOpen, setSectionRequest, setSyncLoginToken]);
}
