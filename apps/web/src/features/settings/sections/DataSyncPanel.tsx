import { useState } from "react";
import { Button, Dialog, TextField, useToast } from "@read-aware/ui";
import { createLogger } from "../../../platform/logger";
import { useTranslation } from "../../../i18n";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import { deleteAllData } from "../lib/delete-all-data";
import { useBackupActions } from "../hooks/useBackupActions";
import { SyncAccountGroup } from "./SyncAccountGroup";
import { useMaintenanceSurface } from "../hooks/useMaintenanceSurface";
import { DataLocationGroup } from "./DataLocationGroup";

const log = createLogger("data-sync");

/**
 * The literal the user must type to arm the delete button. Deliberately the
 * same in every locale: it is a safety ritual, not copy — and an uncommon
 * enough word that it cannot be typed absent-mindedly in any of them.
 */
const DELETE_CONFIRM_PHRASE = "DELETE";

export function DataSyncPanel() {
  const importControlRef = useMaintenanceSurface("backup-import");
  const exportControlRef = useMaintenanceSurface("backup-export");
  const deleteControlRef = useMaintenanceSurface("delete-data");
  const { t } = useTranslation("settings");
  const { toast } = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const { busy, requested, run } = useBackupActions(deleteOpen || deleting);

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
      log.error("delete all data failed", error);
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

      <DataLocationGroup />

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
                ref={importControlRef}
                variant="outline"
                size="sm"
                disabled={busy || deleteOpen || deleting || requested === "export"}
                onClick={() => void run("import")}
              >
                {t("dataSync.import")}
              </Button>
              <Button ref={exportControlRef} size="sm" disabled={busy || deleteOpen || deleting || requested === "import"} onClick={() => void run("export")}>
                {busy ? t("dataSync.working") : t("dataSync.export")}
              </Button>
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
            <Button ref={deleteControlRef} variant="danger" size="sm" disabled={busy || requested !== null} onClick={() => setDeleteOpen(true)}>
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
