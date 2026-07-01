import { useRef, useState } from "react";
import { Alert, Button, Dialog } from "@read-aware/ui";
import { isTauri } from "../../../platform/environment";
import { useTranslation } from "../../../i18n";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import { PendingBadge } from "../components/PendingBadge";
import { resetAllSettings } from "../lib/settings-io";
import { exportBackup, importBackup } from "../lib/backup-io";

type Notice = { variant: "success" | "destructive"; message: string };

const BACKUP_FILENAME = "readaware-backup.json";

export function DataSyncPanel() {
  const { t } = useTranslation("settings");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    try {
      const blob = new Blob([await exportBackup()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = BACKUP_FILENAME;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice({
        variant: "success",
        message: t("dataSync.exportSuccess", { file: BACKUP_FILENAME }),
      });
    } catch (error) {
      setNotice({
        variant: "destructive",
        message: error instanceof Error ? error.message : t("dataSync.exportError"),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleImportFile = async (file: File) => {
    setBusy(true);
    try {
      const result = await importBackup(await file.text());
      setNotice({
        variant: "success",
        message: t("dataSync.merge.summary", {
          books: t("dataSync.merge.books", { count: result.books }),
          annotations: t("dataSync.merge.annotations", { count: result.annotations }),
          collections: t("dataSync.merge.collections", { count: result.collections }),
          settings: t("dataSync.merge.settings", { count: result.settings }),
        }),
      });
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      setNotice({
        variant: "destructive",
        message: error instanceof Error ? error.message : t("dataSync.importError"),
      });
      setBusy(false);
    }
  };

  const confirmReset = () => {
    setResetOpen(false);
    resetAllSettings();
    window.location.reload();
  };

  return (
    <SettingsPage
      title={t("dataSync.title")}
      description={t("dataSync.description")}
    >
      {notice && (
        <Alert
          variant={notice.variant}
          title={notice.variant === "success" ? t("dataSync.noticeDone") : t("dataSync.noticeError")}
        >
          {notice.message}
        </Alert>
      )}

      <SettingsGroup title={t("dataSync.sync")} aside={<PendingBadge />}>
        <SettingsRow
          borderless
          title={t("dataSync.account.title")}
          description={t("dataSync.account.description")}
          control={
            <Button variant="outline" size="sm" disabled>
              {t("dataSync.connectAccount")}
            </Button>
          }
        />
        <SettingsRow
          title={t("dataSync.e2e.title")}
          description={t("dataSync.e2e.description")}
          control={<PendingBadge />}
        />
      </SettingsGroup>

      <SettingsGroup title={t("dataSync.storage")}>
        <SettingsRow
          borderless
          title={t("dataSync.dataLocation.title")}
          description={
            isTauri() ? t("dataSync.dataLocation.descTauri") : t("dataSync.dataLocation.descWeb")
          }
          control={
            <span className="flex items-center gap-2">
              <PendingBadge>{t("dataSync.desktopBadge")}</PendingBadge>
              <Button variant="outline" size="sm" disabled>
                {t("dataSync.reveal")}
              </Button>
            </span>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title={t("dataSync.backup.title")}
        description={t("dataSync.backup.description")}
      >
        <SettingsRow
          borderless
          title={t("dataSync.fullBackup.title")}
          description={t("dataSync.fullBackup.description")}
          control={
            <span className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                {t("dataSync.import")}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void handleExport()}>
                {busy ? t("dataSync.working") : t("dataSync.export")}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void handleImportFile(file);
                }}
              />
            </span>
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("dataSync.dangerZone")}>
        <SettingsRow
          borderless
          title={t("dataSync.reset.title")}
          description={t("dataSync.reset.description")}
          control={
            <Button variant="danger" size="sm" onClick={() => setResetOpen(true)}>
              {t("dataSync.resetButton")}
            </Button>
          }
        />
      </SettingsGroup>

      <Dialog open={resetOpen} onClose={() => setResetOpen(false)} title={t("dataSync.resetDialog.title")}>
        <div className="space-y-4">
          <p>{t("dataSync.resetDialog.body")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setResetOpen(false)}>
              {t("dataSync.resetDialog.cancel")}
            </Button>
            <Button variant="danger" size="sm" onClick={confirmReset}>
              {t("dataSync.resetButton")}
            </Button>
          </div>
        </div>
      </Dialog>
    </SettingsPage>
  );
}
