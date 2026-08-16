/**
 * The Sync group of the Data & Sync panel. Disconnected it is one quiet row
 * with a "Connect account" button — the whole sign-in flow lives in
 * SyncConnectDialog. Connected it shows the account, the last-sync status
 * line, and the "sync now" / disconnect actions.
 */
import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { Button, Dialog, useToast } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { isTauri } from "../../../platform/environment";
import { syncLoginTokenAtom } from "../../../state/ui";
import { PendingBadge } from "../components/PendingBadge";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsRow } from "../components/SettingsRow";
import { SyncProgressDetail } from "../../sync/components/SyncProgressDetail";
import { useSyncBacklog } from "../../sync/hooks/useSyncStatus";
import { useSyncConnection } from "../hooks/useSyncConnection";
import { SyncConnectDialog } from "./SyncConnectDialog";

export function SyncAccountGroup() {
  const { t } = useTranslation("settings");
  const { toast } = useToast();
  const sync = useSyncConnection();

  const [connectOpen, setConnectOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const backlog = useSyncBacklog(sync.connected);

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
      console.error("[sync] manual sync failed", error);
      toast({
        variant: "destructive",
        title: t("dataSync.noticeError"),
        description: t("dataSync.syncStatus.error"),
      });
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

  return (
    <SettingsGroup title={t("dataSync.sync")}>
      <SettingsRow
        borderless
        title={t("dataSync.account.title")}
        description={
          <>
            <span className="block">
              {t("dataSync.connected.description", {
                account: sync.profile?.remoteAccountId ?? "",
              })}
            </span>
            <SyncProgressDetail status={sync.status} backlog={backlog} />
          </>
        }
        control={
          <span className="flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" variant="outline" disabled={syncing} onClick={() => void handleSyncNow()}>
              {syncing ? t("dataSync.syncStatus.syncing") : t("dataSync.connected.syncNow")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDisconnectOpen(true)}>
              {t("dataSync.connected.disconnect")}
            </Button>
          </span>
        }
      />
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
