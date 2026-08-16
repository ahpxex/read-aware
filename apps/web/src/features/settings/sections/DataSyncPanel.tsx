import { useRef, useState } from "react";
import { Button, Dialog, TextField, useToast } from "@read-aware/ui";
import { isTauri } from "../../../platform/environment";
import { useTranslation } from "../../../i18n";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import { PendingBadge } from "../components/PendingBadge";
import { deleteAllData } from "../lib/delete-all-data";
import { exportBackup, importBackup } from "../lib/backup-io";
import { SyncAccountGroup } from "./SyncAccountGroup";

const BACKUP_FILENAME = "readaware-backup.json";
/**
 * The literal the user must type to arm the delete button. Deliberately the
 * same in every locale: it is a safety ritual, not copy — and an uncommon
 * enough word that it cannot be typed absent-mindedly in any of them.
 */
const DELETE_CONFIRM_PHRASE = "DELETE";

export function DataSyncPanel() {
  const { t } = useTranslation("settings");
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

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
      toast({
        variant: "success",
        title: t("dataSync.noticeDone"),
        description: t("dataSync.exportSuccess", { file: BACKUP_FILENAME }),
      });
    } catch (error) {
      // The localized line is the user-facing message; the raw error goes to
      // the console for diagnostics instead of leaking English into the toast.
      console.error("[data-sync] export failed", error);
      toast({
        variant: "destructive",
        title: t("dataSync.noticeError"),
        description: t("dataSync.exportError"),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleImportFile = async (file: File) => {
    setBusy(true);
    try {
      const result = await importBackup(await file.text());
      toast({
        variant: "success",
        title: t("dataSync.noticeDone"),
        description: t("dataSync.merge.summary", {
          books: t("dataSync.merge.books", { count: result.books }),
          annotations: t("dataSync.merge.annotations", { count: result.annotations }),
          collections: t("dataSync.merge.collections", { count: result.collections }),
          settings: t("dataSync.merge.settings", { count: result.settings }),
        }),
      });
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      console.error("[data-sync] import failed", error);
      toast({
        variant: "destructive",
        title: t("dataSync.noticeError"),
        description: t("dataSync.importError"),
      });
      setBusy(false);
    }
  };

  const deleteArmed = deleteConfirmText.trim() === DELETE_CONFIRM_PHRASE;

  const closeDeleteDialog = () => {
    if (deleting) return;
    setDeleteOpen(false);
    setDeleteConfirmText("");
  };

  const confirmDelete = async () => {
    if (!deleteArmed || deleting) return;
    setDeleting(true);
    try {
      await deleteAllData();
      window.location.reload();
    } catch (error) {
      console.error("[data-sync] delete all data failed", error);
      setDeleting(false);
      toast({
        variant: "destructive",
        title: t("dataSync.noticeError"),
        description: t("dataSync.deleteAll.failed"),
      });
    }
  };

  return (
    <SettingsPage
      title={t("dataSync.title")}
      description={t("dataSync.description")}
    >
      <SyncAccountGroup />

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
          title={t("dataSync.deleteAll.title")}
          description={t("dataSync.deleteAll.description")}
          control={
            <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
              {t("dataSync.deleteAll.button")}
            </Button>
          }
        />
      </SettingsGroup>

      <Dialog
        open={deleteOpen}
        onClose={closeDeleteDialog}
        title={t("dataSync.deleteAll.dialogTitle")}
      >
        <div className="space-y-4">
          <p>{t("dataSync.deleteAll.dialogBody")}</p>
          <TextField
            label={t("dataSync.deleteAll.confirmLabel", { phrase: DELETE_CONFIRM_PHRASE })}
            value={deleteConfirmText}
            onChange={(event) => setDeleteConfirmText(event.target.value)}
            placeholder={DELETE_CONFIRM_PHRASE}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={deleting} onClick={closeDeleteDialog}>
              {t("dataSync.deleteAll.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!deleteArmed || deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? t("dataSync.deleteAll.deleting") : t("dataSync.deleteAll.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    </SettingsPage>
  );
}
