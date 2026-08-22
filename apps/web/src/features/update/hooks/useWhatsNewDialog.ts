import { useCallback, useEffect, useState } from "react";
import { useLocale } from "../../../i18n";
import { getGeneralSettings } from "../../settings/lib/general-settings";
import { fetchWhatsNewEntry, type WhatsNewEntry } from "../lib/changelog-feed";
import { readCurrentAppVersion } from "../lib/software-update";
import { dismissWhatsNew, reconcileWhatsNew } from "../lib/whats-new";
import { versionCodename } from "../lib/version-codename";

/**
 * The post-upgrade "what's new" dialog: raised once per version change (same
 * reconcile/TTL state machine the old header chip used — see lib/whats-new).
 * The dialog opens IMMEDIATELY with a loading body — the changelog entry is
 * fetched on the fly from the landing site (lib/changelog-feed) and fills in
 * when it lands (stable releases), or gives way to the one-line fallback
 * when it doesn't (pre-releases are deliberately not curated on the site).
 * A bounded timeout caps the wait, so the skeleton can never hang; closing
 * the dialog — any button, Escape, the backdrop — dismisses the notice for
 * good. When the user turned the dialog off in Settings the notice is
 * consumed silently instead, so a later re-enable never pops a stale
 * version.
 */
export function useWhatsNewDialog(): {
  version: string | null;
  codename: string | null;
  entry: WhatsNewEntry | null;
  loading: boolean;
  close: () => void;
} {
  const locale = useLocale();
  const [state, setState] = useState<{
    version: string;
    entry: WhatsNewEntry | null;
    loading: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readCurrentAppVersion()
      .then(async (current) => {
        if (cancelled || !current) return;
        const notice = reconcileWhatsNew(current);
        if (!notice) return;
        if (!getGeneralSettings().whatsNewDialog) {
          dismissWhatsNew();
          return;
        }
        // Open first, load after — the dialog must never wait on the network.
        setState({ version: notice.version, entry: null, loading: true });
        const entry = await fetchWhatsNewEntry(notice.version, locale);
        if (cancelled) return;
        setState({ version: notice.version, entry, loading: false });
      })
      .catch(() => {
        // A failed version read means no Tauri (browser dev) — nothing to do.
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const close = useCallback(() => {
    dismissWhatsNew();
    setState(null);
  }, []);

  const codename = state
    ? (state.entry?.codename ?? versionCodename(state.version))
    : null;
  return {
    version: state?.version ?? null,
    codename,
    entry: state?.entry ?? null,
    loading: state?.loading ?? false,
    close,
  };
}
