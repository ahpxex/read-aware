/**
 * The Sync group of the Data & Sync panel. Disconnected it is one quiet row
 * with a "Connect account" button — the whole sign-in flow lives in
 * SyncConnectDialog. Connected it follows the panel's row grammar, one
 * concern per row with its own control: Account (identity / disconnect),
 * Status (last sync / sync now, or the re-login), Plan (tier + usage /
 * upgrade or manage). The icon-strip detail stays in the header popover.
 */
import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { Button, Dialog, useToast } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { isTauri } from "../../../platform/environment";
import { openExternalUrl } from "../../../platform/external-link";
import { createLogger } from "../../../platform/logger";
import { siteBaseUrl } from "../../../platform/site-url";
import { syncRelayClient } from "../../../platform/sync/sync-scheduler";
import { syncLoginTokenAtom } from "../../../state/ui";
import { PendingBadge } from "../components/PendingBadge";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsRow } from "../components/SettingsRow";
import { syncCycleFraction } from "../../sync/lib/sync-progress";
import { useSyncBacklog } from "../../sync/hooks/useSyncStatus";
import { useSyncAccountInfo } from "../hooks/useSyncAccountInfo";
import { useSyncConnection } from "../hooks/useSyncConnection";
import { SyncConnectDialog } from "./SyncConnectDialog";

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

/** "12 345 678" bytes → "11.8 MB": one decimal, sensible unit. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes;
  let unit: (typeof units)[number] = "KB";
  for (const next of units) {
    value /= 1024;
    unit = next;
    if (value < 1024) break;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

export function SyncAccountGroup() {
  const { t, i18n } = useTranslation("settings");
  const { toast } = useToast();
  const sync = useSyncConnection();

  const [connectOpen, setConnectOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const backlog = useSyncBacklog(sync.connected);
  const accountInfo = useSyncAccountInfo(sync.connected);

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

  // The web shell has no store and no sync — keep the pre-sync placeholder.
  if (!isTauri()) {
    return (
      <SettingsGroup title={t("dataSync.sync")} aside={<PendingBadge>{t("dataSync.desktopBadge")}</PendingBadge>}>
        <SettingsRow
          borderless
          title={t("dataSync.account.title")}
          description={t("dataSync.account.description")}
        />
      </SettingsGroup>
    );
  }

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

  if (!sync.connected) {
    return (
      <SettingsGroup title={t("dataSync.sync")}>
        <SettingsRow
          borderless
          title={t("dataSync.account.title")}
          description={t("dataSync.account.description")}
          control={
            <Button size="sm" onClick={() => setConnectOpen(true)}>
              {t("dataSync.connectAccount")}
            </Button>
          }
        />
        <SyncConnectDialog open={connectOpen} onClose={() => setConnectOpen(false)} sync={sync} />
      </SettingsGroup>
    );
  }

  const syncing = sync.status.state === "syncing";
  // The email is the human name of the account; the opaque id only appears
  // while the relay hasn't answered yet (offline), shortened to stay legible.
  const accountLabel =
    accountInfo?.email ?? `${(sync.profile?.remoteAccountId ?? "").slice(0, 8)}…`;

  // The Status row's one-line description: exactly one voice at a time —
  // a rejected session and a failed cycle speak in the warning tone.
  const fraction = syncCycleFraction(sync.status);
  const pending = backlog !== null && backlog.events + backlog.blobs > 0 ? backlog : null;
  const statusDescription = sessionRejected ? (
    <span className="text-red-700">{t("dataSync.syncStatus.signedOut")}</span>
  ) : sync.status.state === "error" ? (
    <span className="text-red-700">{sync.status.lastError ?? t("dataSync.syncStatus.error")}</span>
  ) : syncing ? (
    fraction === null
      ? t("dataSync.syncStatus.syncing")
      : `${t("dataSync.syncStatus.syncing")} ${Math.round(fraction * 100)}%`
  ) : (
    [
      sync.status.lastSyncAt
        ? t("dataSync.syncStatus.lastSync", {
            time: new Date(sync.status.lastSyncAt).toLocaleTimeString(),
          })
        : t("dataSync.syncStatus.never"),
      pending &&
        t("dataSync.progress.pending", { events: pending.events, blobs: pending.blobs }),
    ]
      .filter(Boolean)
      .join(" · ")
  );

  // A currently-paying account manages its plan in Stripe's portal. Free
  // accounts get the upgrade menu even when a past customer exists (checkout
  // reuses it — after a cancellation the portal has nothing left to manage).
  // A paid tier WITHOUT billing was granted by the operator; staff plans are
  // never sold, so staff sees no control at all.
  const planControl =
    accountInfo && accountInfo.tier !== "staff" ? (
      accountInfo.tier !== "free" ? (
        accountInfo.hasBilling ? (
          <Button size="sm" variant="outline" onClick={() => void openPortal()}>
            {t("dataSync.billing.manage")}
          </Button>
        ) : null
      ) : (
        // Plans are compared and bought on the landing's pricing page — the
        // app doesn't reprint the catalog, it opens the one source of it.
        <Button size="sm" variant="outline" onClick={() => void openUpgrade()}>
          {t("dataSync.billing.upgrade")}
        </Button>
      )
    ) : null;

  const overLimit =
    accountInfo?.limits?.maxAccountBlobBytes != null &&
    accountInfo.blobBytesUsed > accountInfo.limits.maxAccountBlobBytes;

  return (
    <SettingsGroup title={t("dataSync.sync")}>
      <SettingsRow
        borderless
        title={t("dataSync.account.title")}
        description={accountLabel}
        control={
          <Button size="sm" variant="ghost" onClick={() => setDisconnectOpen(true)}>
            {t("dataSync.connected.disconnect")}
          </Button>
        }
      />
      <SettingsRow
        title={t("dataSync.connected.statusTitle")}
        description={statusDescription}
        control={
          // A rejected session makes "sync now" a guaranteed 401 — its slot
          // offers the re-login (the same connect dialog) instead.
          sessionRejected ? (
            <Button size="sm" onClick={() => setConnectOpen(true)}>
              {t("dataSync.reauth.action")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={syncing}
              onClick={() => void handleSyncNow()}
            >
              {syncing ? t("dataSync.syncStatus.syncing") : t("dataSync.connected.syncNow")}
            </Button>
          )
        }
      />
      {/* Fetched from the relay, so quietly absent while offline. */}
      {accountInfo && (
        <SettingsRow
          title={t("dataSync.connected.planTitle")}
          description={
            <>
              {t(`dataSync.tier.${accountInfo.tier ?? "free"}`)}
              {" · "}
              <span className={overLimit ? "text-red-700" : undefined}>
                {/* A self-hosted relay predating tiers sends no limits — fall
                    back to the plain usage line rather than "of undefined". */}
                {accountInfo.limits?.maxAccountBlobBytes != null
                  ? t("dataSync.connected.storageUsedOfLimit", {
                      used: formatBytes(accountInfo.blobBytesUsed),
                      limit: formatBytes(accountInfo.limits.maxAccountBlobBytes),
                    })
                  : t("dataSync.connected.storageUsed", {
                      used: formatBytes(accountInfo.blobBytesUsed),
                    })}
              </span>
            </>
          }
          control={planControl}
        />
      )}
      <SettingsRow
        title={t("dataSync.e2e.title")}
        description={t("dataSync.e2e.active")}
      />
      {/* Re-login for a rejected session: the same connect flow, reached from
          the "sign in again" control above (or a deep-linked token). */}
      <SyncConnectDialog open={connectOpen} onClose={() => setConnectOpen(false)} sync={sync} />
      <Dialog
        open={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        title={t("dataSync.connected.disconnectTitle")}
      >
        <div className="space-y-4">
          <p>{t("dataSync.connected.disconnectBody")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDisconnectOpen(false)}>
              {t("dataSync.connected.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setDisconnectOpen(false);
                void sync.disconnect();
              }}
            >
              {t("dataSync.connected.disconnect")}
            </Button>
          </div>
        </div>
      </Dialog>
    </SettingsGroup>
  );
}
