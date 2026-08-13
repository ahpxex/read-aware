/**
 * The Sync group of the Data & Sync panel: connect an account (magic link +
 * E2E passphrase), or — once connected — status, "sync now", and disconnect.
 * Replaces the pre-sync PendingBadge placeholders.
 */
import { useState } from "react";
import { Button, Caption, Dialog, TextField, useToast } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { isTauri } from "../../../platform/environment";
import { PendingBadge } from "../components/PendingBadge";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsRow } from "../components/SettingsRow";
import {
  MIN_PASSPHRASE_LENGTH,
  useSyncConnection,
  WrongPassphraseError,
} from "../hooks/useSyncConnection";

export function SyncAccountGroup() {
  const { t } = useTranslation("settings");
  const { toast } = useToast();
  const sync = useSyncConnection();

  const [email, setEmail] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [token, setToken] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

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

  const handleSend = async () => {
    try {
      const devToken = await sync.sendLink(email);
      setLinkSent(true);
      if (devToken) setToken(devToken);
    } catch (error) {
      console.error("[sync] magic link request failed", error);
      toast({
        variant: "destructive",
        title: t("dataSync.noticeError"),
        description: t("dataSync.connect.failed"),
      });
    }
  };

  const handleConnect = async () => {
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      setPassphraseError(t("dataSync.connect.passphraseTooShort"));
      return;
    }
    setPassphraseError(null);
    try {
      await sync.connect(token, passphrase);
      setEmail("");
      setToken("");
      setPassphrase("");
      setLinkSent(false);
      toast({
        variant: "success",
        title: t("dataSync.noticeDone"),
        description: t("dataSync.connect.connected"),
      });
    } catch (error) {
      if (error instanceof WrongPassphraseError) {
        setPassphraseError(t("dataSync.connect.wrongPassphrase"));
        return;
      }
      console.error("[sync] connect failed", error);
      toast({
        variant: "destructive",
        title: t("dataSync.noticeError"),
        description: t("dataSync.connect.failed"),
      });
    }
  };

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

  if (sync.connected) {
    const syncing = sync.status.state === "syncing";
    const statusLine =
      sync.status.state === "error"
        ? t("dataSync.syncStatus.error")
        : sync.status.lastSyncAt
          ? t("dataSync.syncStatus.lastSync", {
              time: new Date(sync.status.lastSyncAt).toLocaleTimeString(),
            })
          : t("dataSync.syncStatus.never");
    return (
      <SettingsGroup title={t("dataSync.sync")}>
        <SettingsRow
          borderless
          title={t("dataSync.account.title")}
          description={t("dataSync.connected.description", {
            account: sync.profile?.remoteAccountId ?? "",
          })}
          control={
            <span className="flex items-center gap-2">
              <Caption className="text-fg-muted">{statusLine}</Caption>
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

  return (
    <SettingsGroup title={t("dataSync.sync")} description={t("dataSync.account.description")}>
      <div className="space-y-4 py-3">
        <div className="flex items-end gap-3">
          <TextField
            className="flex-1"
            label={t("dataSync.connect.emailLabel")}
            type="email"
            placeholder={t("dataSync.connect.emailPlaceholder")}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
          <Button
            size="sm"
            disabled={sync.busy || !email.includes("@")}
            onClick={() => void handleSend()}
          >
            {sync.busy && !linkSent ? t("dataSync.connect.sending") : t("dataSync.connect.send")}
          </Button>
        </div>
        {linkSent && (
          <>
            <Caption className="text-fg-muted">{t("dataSync.connect.sent")}</Caption>
            <TextField
              label={t("dataSync.connect.tokenLabel")}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
            />
            <TextField
              label={t("dataSync.connect.passphraseLabel")}
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              helperText={t("dataSync.connect.passphraseHint")}
              error={passphraseError ?? undefined}
              autoComplete="new-password"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={sync.busy || token.trim().length === 0}
                onClick={() => void handleConnect()}
              >
                {sync.busy ? t("dataSync.connect.connecting") : t("dataSync.connect.connect")}
              </Button>
            </div>
          </>
        )}
      </div>
    </SettingsGroup>
  );
}
