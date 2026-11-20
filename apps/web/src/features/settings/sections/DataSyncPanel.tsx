import { useState, useSyncExternalStore } from "react";
import { Button, Dialog, InlineError, TextField, useToast } from "@read-aware/ui";
import { ERR_DATA_WIPE_INCOMPLETE, errorCode } from "@read-aware/core";
import { createLogger } from "../../../platform/logger";
import { isMobileOS } from "../../../platform/environment";
import { useTranslation } from "../../../i18n";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import { deleteAllData, getDataWipeState, subscribeDataWipe } from "../lib/delete-all-data";
import { describeError } from "../../../i18n/describe-error";
import { useBackupActions } from "../hooks/useBackupActions";
import { SyncAccountGroup } from "./SyncAccountGroup";
import { useMaintenanceSurface } from "../hooks/useMaintenanceSurface";
import { DataLocationGroup } from "./DataLocationGroup";
import { ContextBundlesGroup } from "./ContextBundlesGroup";
import { BackupImportDialog } from "../components/BackupImportDialog";
import { BackupExportDialog } from "../components/BackupExportDialog";

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
  const wipe = useSyncExternalStore(subscribeDataWipe, getDataWipeState);
  const deleting = wipe?.phase === "working";
  const reloadRequired = wipe?.phase === "reload-required";
  const { busy, requested, run, exportDialog, importDialog } = useBackupActions(deleteOpen || wipe !== null);

  const deleteArmed = deleteConfirmText.trim() === DELETE_CONFIRM_PHRASE;

  const closeDeleteDialog = () => {
    if (wipe) return;
    setDeleteOpen(false);
    setDeleteConfirmText("");
  };

  const confirmDelete = async () => {
    if (!deleteArmed || wipe) return;
    try {
      await deleteAllData();
      window.location.reload();
    } catch (error) {
      log.error("delete all data failed", error);
      if (errorCode(error) === ERR_DATA_WIPE_INCOMPLETE) return; // Persistent recovery controls below.
      toast({
        variant: "destructive",
        title: t("dataSync.noticeError"),
        description: t("dataSync.deleteAll.failed"),
      });
    }
  };

  return (
    <SettingsPage title={t("dataSync.title")} description={t("dataSync.description")}>
      <SyncAccountGroup />

      {/* The data directory and context bundles are desktop-only; on a phone
          they would be a disabled button and a block of disabled controls. */}
      {!isMobileOS() && <DataLocationGroup />}

      <SettingsGroup title={t("dataSync.backup.title")} description={t("dataSync.backup.description")}>
        <SettingsRow
          borderless
          title={t("dataSync.exportDialog.title")}
          description={t("dataSync.exportDialog.fullDescription")}
          control={
            <Button
              ref={exportControlRef}
              size="sm"
              disabled={busy || deleteOpen || deleting || requested === "import"}
              onClick={() => void run("export")}
            >
              {busy ? t("dataSync.working") : t("dataSync.export")}
            </Button>
          }
        />
        <SettingsRow
          title={t("dataSync.importDialog.title")}
          description={t("dataSync.importDialog.description")}
          control={
            <Button
              ref={importControlRef}
              variant="outline"
              size="sm"
              disabled={busy || deleteOpen || deleting || requested === "export"}
              onClick={() => void run("import")}
            >
              {t("dataSync.import")}
            </Button>
          }
        />
      </SettingsGroup>

      <BackupExportDialog flow={exportDialog} />
      <BackupImportDialog flow={importDialog} />

      {!isMobileOS() && <ContextBundlesGroup />}

      <SettingsGroup title={t("dataSync.dangerZone")}>
        <SettingsRow
          borderless
          title={t("dataSync.deleteAll.title")}
          description={t("dataSync.deleteAll.description")}
          control={
            <Button
              ref={deleteControlRef}
              variant="danger"
              size="sm"
              disabled={busy || requested !== null || wipe !== null}
              onClick={() => setDeleteOpen(true)}
            >
              {t("dataSync.deleteAll.button")}
            </Button>
          }
        />
      </SettingsGroup>

      <Dialog
        open={deleteOpen || wipe !== null}
        onClose={closeDeleteDialog}
        title={t("dataSync.deleteAll.dialogTitle")}
      >
        <div className="space-y-4">
          {reloadRequired ? (
            <>
              {wipe.error && <InlineError>{describeError(wipe.error).body}</InlineError>}
              <Button onClick={() => window.location.reload()}>{t("about.diagnostics.repair.reload")}</Button>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </Dialog>
    </SettingsPage>
  );
}
