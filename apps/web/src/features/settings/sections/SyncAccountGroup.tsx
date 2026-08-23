/**
 * The Sync group's container: the live connection, the relay's account info,
 * the outbox backlogs, and the billing round-trips. The rows themselves are
 * `SyncAccountGroupView`.
 */
import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { useToast } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { isTauri } from "../../../platform/environment";
import { openExternalUrl } from "../../../platform/external-link";
import { createLogger } from "../../../platform/logger";
import { siteBaseUrl } from "../../../platform/site-url";
import { syncRelayClient } from "../../../platform/sync/sync-scheduler";
import { syncLoginTokenAtom } from "../../../state/ui";
import { useBlobBookTitle } from "../../sync/hooks/useBlobBookTitle";
import { useSyncBacklog, useSyncBookBacklog } from "../../sync/hooks/useSyncStatus";
import { useSyncAccountInfo } from "../hooks/useSyncAccountInfo";
import { useSyncConnection } from "../hooks/useSyncConnection";
import { SyncAccountGroupView } from "./SyncAccountGroupView";

const log = createLogger("sync");

/** App locale → the landing site's locale prefix (English lives at the root). */
const LANDING_LOCALE: Record<string, string> = {
  "zh-Hans": "zh",
  "zh-Hant": "zh-hant",
  ja: "ja",
  fr: "fr",
  de: "de",
  ru: "ru",
  es: "es",
};

/**
 * The landing pricing page in the app's language — where "Upgrade plan"
 * leads. Its paid cards start a web checkout; fulfillment reaches the account
 * by the paid email (accounts are keyed by email), so no session must travel.
 */
function pricingUrl(locale: string): string {
  const prefix = LANDING_LOCALE[locale];
  return prefix ? `${siteBaseUrl()}/${prefix}/pricing` : `${siteBaseUrl()}/pricing`;
}

export function SyncAccountGroup() {
  const { t, i18n } = useTranslation("settings");
  const { toast } = useToast();
  const sync = useSyncConnection();

  const [connectOpen, setConnectOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const backlog = useSyncBacklog(sync.connected);
  const bookBacklog = useSyncBookBacklog(sync.connected);
  const accountInfo = useSyncAccountInfo(sync.connected);
  const movingBookTitle = useBlobBookTitle(
    sync.status.state === "syncing" ? (sync.status.progress?.blobKey ?? null) : null,
  );

  // A deep-linked sign-in token opens the connect dialog, which consumes the
  // atom itself. Already connected — with a session the relay still honors —
  // the link has nothing left to do; a rejected session is exactly what the
  // link re-establishes, so it opens the dialog like a first sign-in.
  const [linkToken, setLinkToken] = useAtom(syncLoginTokenAtom);
  const { connected } = sync;
  const sessionRejected = sync.status.state === "unauthenticated";
  useEffect(() => {
    if (!linkToken) return;
    if (connected && !sessionRejected) {
      setLinkToken(null);
      return;
    }
    setConnectOpen(true);
  }, [linkToken, connected, sessionRejected, setLinkToken]);

  const handleSyncNow = async () => {
    try {
      await sync.requestSyncNow();
    } catch (error) {
      log.error("manual sync failed", error);
      toast({
        variant: "destructive",
        title: t("dataSync.noticeError"),
        description: t("dataSync.syncStatus.error"),
      });
    }
  };

  const billingFailed = (error: unknown) => {
    log.error("billing session failed", error);
    toast({
      variant: "destructive",
      title: t("dataSync.noticeError"),
      description: t("dataSync.billing.failed"),
    });
  };

  const openPortal = async () => {
    try {
      await openExternalUrl(await syncRelayClient().createPortal());
    } catch (error) {
      billingFailed(error);
    }
  };

  const openUpgrade = async () => {
    let target = pricingUrl(i18n.language);
    try {
      // The ticket lets the pricing page bind its checkout to THIS account
      // and return the buyer to the app afterwards. It rides in the fragment
      // — never sent to any server, never logged.
      const ticket = await syncRelayClient().billingTicket();
      target += `#upgrade=${encodeURIComponent(ticket)}`;
    } catch {
      // Offline or a pre-ticket relay: the plain pricing page still sells —
      // fulfillment falls back to matching the checkout email.
    }
    try {
      await openExternalUrl(target);
    } catch (error) {
      billingFailed(error);
    }
  };

  return (
    <SyncAccountGroupView
      // The web shell has no store and no sync — keep the pre-sync placeholder.
      supported={isTauri()}
      connected={sync.connected}
      status={sync.status}
      profile={sync.profile}
      accountInfo={accountInfo}
      backlog={backlog}
      bookBacklog={bookBacklog}
      movingBookTitle={movingBookTitle}
      connectOpen={connectOpen}
      onConnectOpenChange={setConnectOpen}
      disconnectOpen={disconnectOpen}
      onDisconnectOpenChange={setDisconnectOpen}
      onSyncNow={() => void handleSyncNow()}
      onDisconnect={() => void sync.disconnect()}
      onOpenPortal={() => void openPortal()}
      onOpenUpgrade={() => void openUpgrade()}
      sync={sync}
    />
  );
}
