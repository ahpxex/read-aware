import { useRef, useState } from "react";
import { Alert, Button } from "@read-aware/ui";
import { isTauri } from "../../../platform/environment";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import { PendingBadge } from "../components/PendingBadge";
import { applySettings, resetAllSettings, serializeSettings } from "../lib/settings-io";

type Notice = { variant: "success" | "destructive"; message: string };

export function DataSyncPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const handleExport = () => {
    const blob = new Blob([serializeSettings()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "readaware-settings.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice({ variant: "success", message: "Settings exported to readaware-settings.json." });
  };

  const handleImportFile = async (file: File) => {
    try {
      const applied = applySettings(await file.text());
      setNotice({
        variant: "success",
        message: `Imported ${applied} setting group${applied === 1 ? "" : "s"}. Reloading…`,
      });
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setNotice({
        variant: "destructive",
        message: error instanceof Error ? error.message : "Could not import this file.",
      });
    }
  };

  const handleReset = () => {
    const confirmed = window.confirm(
      "Reset all ReadAware settings to their defaults? Your library and books are not affected.",
    );
    if (!confirmed) return;
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
        description="Export settings to move them to another device, or restore from a previous export."
      >
        <SettingsRow
          borderless
          title="Settings"
          description="Download every preference as a portable JSON file, or import one."
          control={
            <span className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                Import
              </Button>
              <Button size="sm" onClick={handleExport}>
                Export
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
        <SettingsRow
          title="Library & annotations"
          description="Export your books, highlights, notes, and context bundles."
          control={<PendingBadge />}
        />
      </SettingsGroup>

      <SettingsGroup title="Danger zone">
        <SettingsRow
          borderless
          title="Reset all settings"
          description="Restore every preference to its default. Books and annotations are kept."
          control={
            <Button variant="danger" size="sm" onClick={handleReset}>
              Reset settings
            </Button>
          }
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
