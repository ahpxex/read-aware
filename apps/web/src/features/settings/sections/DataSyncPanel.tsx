import { useRef, useState } from "react";
import { Alert, Button, Dialog } from "@read-aware/ui";
import { isTauri } from "../../../platform/environment";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import { PendingBadge } from "../components/PendingBadge";
import { resetAllSettings } from "../lib/settings-io";
import { exportBackup, importBackup } from "../lib/backup-io";

type Notice = { variant: "success" | "destructive"; message: string };

export function DataSyncPanel() {
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
      anchor.download = "readaware-backup.json";
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice({ variant: "success", message: "Everything exported to readaware-backup.json." });
    } catch (error) {
      setNotice({
        variant: "destructive",
        message: error instanceof Error ? error.message : "Could not export your data.",
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
        message: `Merged ${result.books} book${result.books === 1 ? "" : "s"}, ${result.annotations} annotation${result.annotations === 1 ? "" : "s"}, ${result.collections} collection${result.collections === 1 ? "" : "s"}, and ${result.settings} setting${result.settings === 1 ? "" : "s"}. Reloading…`,
      });
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      setNotice({
        variant: "destructive",
        message: error instanceof Error ? error.message : "Could not import this file.",
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
      title="Data & Sync"
      description="ReadAware is local-first: your data lives on this device. Sync is an encrypted relay, not a source of truth."
    >
      {notice && (
        <Alert variant={notice.variant} title={notice.variant === "success" ? "Done" : "Error"}>
          {notice.message}
        </Alert>
      )}

      <SettingsGroup title="Sync" aside={<PendingBadge />}>
        <SettingsRow
          borderless
          title="Account"
          description="Connect an account to sync your encrypted event log across devices."
          control={
            <Button variant="outline" size="sm" disabled>
              Connect account
            </Button>
          }
        />
        <SettingsRow
          title="End-to-end encryption"
          description="Synced data is encrypted on-device. Manage your passphrase and devices here."
          control={<PendingBadge />}
        />
      </SettingsGroup>

      <SettingsGroup title="Storage">
        <SettingsRow
          borderless
          title="Data location"
          description={
            isTauri()
              ? "Stored in the ReadAware application data folder on this Mac."
              : "Stored in this browser. The desktop app keeps data in a local folder you control."
          }
          control={
            <span className="flex items-center gap-2">
              <PendingBadge>Desktop</PendingBadge>
              <Button variant="outline" size="sm" disabled>
                Reveal
              </Button>
            </span>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Backup & export"
        description="Save everything on this device to a single file — move it to another device or keep it as a backup. Importing merges a backup back into your current data."
      >
        <SettingsRow
          borderless
          title="Full backup"
          description="Books, highlights, notes, collections, reading progress, and every preference, in one portable file."
          control={
            <span className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                Import
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void handleExport()}>
                {busy ? "Working…" : "Export"}
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

      <SettingsGroup title="Danger zone">
        <SettingsRow
          borderless
          title="Reset all settings"
          description="Restore every preference to its default. Books and annotations are kept."
          control={
            <Button variant="danger" size="sm" onClick={() => setResetOpen(true)}>
              Reset settings
            </Button>
          }
        />
      </SettingsGroup>

      <Dialog open={resetOpen} onClose={() => setResetOpen(false)} title="Reset all settings?">
        <div className="space-y-4">
          <p>
            Restore every preference to its default. Your books and annotations are kept — only
            settings are reset. This can’t be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={confirmReset}>
              Reset settings
            </Button>
          </div>
        </div>
      </Dialog>
    </SettingsPage>
  );
}
