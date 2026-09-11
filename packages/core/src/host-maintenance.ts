export type HostUpdatePhase = "idle" | "checking" | "up-to-date" | "available" | "downloading"
  | "installing" | "permission-required" | "installer-open" | "error";
export type HostUpdateState = {
  phase: HostUpdatePhase;
  currentVersion: string | null;
  availableVersion: string | null;
  progress: number | null;
  errorStage: "check" | "install" | null;
};
export const HOST_MAINTENANCE_SURFACES = ["updates", "diagnostics", "plugins", "backup-import", "backup-export", "delete-data", "ai-connection", "data-location"] as const;
export type HostMaintenanceSurface = typeof HOST_MAINTENANCE_SURFACES[number];
export type BackupAction = "import" | "export";
export type BackupReceipt = { action: BackupAction; status: "imported" | "exported" | "cancelled" };
export type ConnectionTestReceipt = { action: "test"; status: "responded" | "empty" | "cancelled" };
export type HostMaintenanceSnapshot = HostUpdateState & {
  supported: boolean;
  channel: "stable" | "beta";
  /** Channel of the last successful check, not necessarily the selected channel. */
  checkedChannel: "stable" | "beta" | null;
};
export type HostMaintenancePort = {
  /** Reveal the native test button and await an explicit user click; no configuration or response text. */
  requestConnectionTest(signal?: AbortSignal): Promise<ConnectionTestReceipt>;
  /** Reveal a host button, then await the user's native action. No bytes or paths. */
  requestBackup(action: BackupAction, signal?: AbortSignal): Promise<BackupReceipt>;
  snapshot(): Promise<HostMaintenanceSnapshot>;
  /** Checks the host release feed only. Never downloads, installs or restarts. */
  checkForUpdates(signal?: AbortSignal): Promise<HostMaintenanceSnapshot>;
  /** Reveals mounted host controls, never clicks them. No install, backup or wipe executes. */
  openSettings(surface: HostMaintenanceSurface, signal?: AbortSignal): Promise<{ status: "opened"; surface: HostMaintenanceSurface }>;
};
