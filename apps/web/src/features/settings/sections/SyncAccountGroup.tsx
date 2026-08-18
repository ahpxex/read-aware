/**
 * The Sync group of the Data & Sync panel. Disconnected it is one quiet row
 * with a "Connect account" button — the whole sign-in flow lives in
 * SyncConnectDialog. Connected it shows the account, the last-sync status
 * line, and the "sync now" / disconnect actions.
 */
import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { Button, Dialog, DropdownMenu, useToast } from "@read-aware/ui";
import type { BillingPlanId } from "@read-aware/core";
import { useTranslation } from "../../../i18n";
import { isTauri } from "../../../platform/environment";
import { openExternalUrl } from "../../../platform/external-link";
import { createLogger } from "../../../platform/logger";
import { RelayError } from "../../../platform/sync/relay-client";
import { syncRelayClient } from "../../../platform/sync/sync-scheduler";
import { syncLoginTokenAtom } from "../../../state/ui";
import { PendingBadge } from "../components/PendingBadge";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsRow } from "../components/SettingsRow";
import { SyncProgressDetail } from "../../sync/components/SyncProgressDetail";
import { useSyncBacklog } from "../../sync/hooks/useSyncStatus";
import { useSyncAccountInfo } from "../hooks/useSyncAccountInfo";
import { useSyncConnection } from "../hooks/useSyncConnection";
import { SyncConnectDialog } from "./SyncConnectDialog";

const log = createLogger("sync");

/** App locale → the landing's pricing-page locale prefix (relay validates). */
const CHECKOUT_LOCALE: Record<string, string> = {
  "zh-Hans": "zh",
  "zh-Hant": "zh-hant",
  ja: "ja",
  fr: "fr",
  de: "de",
  ru: "ru",
  es: "es",
};

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
  // atom itself. Already connected, the link has nothing left to do.
  const [linkToken, setLinkToken] = useAtom(syncLoginTokenAtom);
  const { connected } = sync;
  useEffect(() => {
    if (!linkToken) return;
    if (connected) {
      setLinkToken(null);
      return;
    }
    setConnectOpen(true);
  }, [linkToken, connected, setLinkToken]);

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

  const openCheckout = async (plan: BillingPlanId) => {
    try {
      const url = await syncRelayClient().createCheckout(plan, CHECKOUT_LOCALE[i18n.language]);
      await openExternalUrl(url);
    } catch (error) {
      // 409 = an active subscription already exists (e.g. re-tiering): the
      // portal, not a second checkout, is the right door — open it instead.
      if (error instanceof RelayError && error.status === 409) return openPortal();
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

  return (
    <SettingsGroup title={t("dataSync.sync")}>
      <SettingsRow
        borderless
        title={t("dataSync.account.title")}
        description={t("dataSync.connected.description", { account: accountLabel })}
        control={
          <span className="flex flex-wrap items-center justify-end gap-2">
            {/* A currently-paying account manages its plan in Stripe's portal.
                Free accounts get the upgrade menu even when a past customer
                exists (checkout reuses it — after a cancellation the portal
                has nothing left to manage). A paid tier WITHOUT billing was
                granted by the operator; staff plans are never sold. */}
            {accountInfo && accountInfo.tier !== "staff" && (
              accountInfo.tier !== "free" ? (
                accountInfo.hasBilling && (
                  <Button size="sm" variant="ghost" onClick={() => void openPortal()}>
                    {t("dataSync.billing.manage")}
                  </Button>
                )
              ) : (
                <DropdownMenu
                  align="right"
                  triggerLabel={t("dataSync.billing.upgrade")}
                  trigger={
                    <span className="inline-flex h-8 items-center rounded-md px-3 text-sm text-fg-muted transition-colors hover:text-fg">
                      {t("dataSync.billing.upgrade")}
                    </span>
                  }
                  items={[
                    { label: "Sync · $5", onClick: () => void openCheckout("sync") },
                    { label: "Pro · $20", onClick: () => void openCheckout("pro") },
                    { label: "Max · $50", onClick: () => void openCheckout("max") },
                  ]}
                />
              )
            )}
            <Button size="sm" variant="outline" disabled={syncing} onClick={() => void handleSyncNow()}>
              {syncing ? t("dataSync.syncStatus.syncing") : t("dataSync.connected.syncNow")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDisconnectOpen(true)}>
              {t("dataSync.connected.disconnect")}
            </Button>
          </span>
        }
      />
      {/* Full row width, not the label column: the facts strip breathes
          horizontally instead of stacking into a tall cramped description. */}
      <div className="pb-3.5">
        <SyncProgressDetail
          status={sync.status}
          backlog={backlog}
          plan={
            accountInfo
              ? t("dataSync.connected.plan", {
                  tier: t(`dataSync.tier.${accountInfo.tier ?? "free"}`),
                })
              : null
          }
          storage={
            accountInfo
              ? // A self-hosted relay predating tiers sends no limits — fall
                // back to the plain usage line rather than "of undefined".
                accountInfo.limits?.maxAccountBlobBytes != null
                ? t("dataSync.connected.storageUsedOfLimit", {
                    used: formatBytes(accountInfo.blobBytesUsed),
                    limit: formatBytes(accountInfo.limits.maxAccountBlobBytes),
                  })
                : t("dataSync.connected.storageUsed", {
                    used: formatBytes(accountInfo.blobBytesUsed),
                  })
              : null
          }
        />
      </div>
      <SettingsRow
        title={t("dataSync.e2e.title")}
        description={t("dataSync.e2e.active")}
      />
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
