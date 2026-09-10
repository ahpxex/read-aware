export type HostUpdatePhase = "idle" | "checking" | "up-to-date" | "available" | "downloading"
  | "installing" | "permission-required" | "installer-open" | "error";
export type HostUpdateState = {
  phase: HostUpdatePhase;
  currentVersion: string | null;
  availableVersion: string | null;
  progress: number | null;
  errorStage: "check" | "install" | null;
};
export const HOST_MAINTENANCE_SURFACES = ["updates", "diagnostics", "plugins", "backup-import", "backup-export", "delete-data"] as const;
export type HostMaintenanceSurface = typeof HOST_MAINTENANCE_SURFACES[number];
export type HostMaintenanceSnapshot = HostUpdateState & {
  supported: boolean;
  channel: "stable" | "beta";
  /** Channel of the last successful check, not necessarily the selected channel. */
  checkedChannel: "stable" | "beta" | null;
};
export type HostMaintenancePort = {
  snapshot(): Promise<HostMaintenanceSnapshot>;
  /** Checks the host release feed only. Never downloads, installs or restarts. */
  checkForUpdates(signal?: AbortSignal): Promise<HostMaintenanceSnapshot>;
  /** Reveals mounted host controls, never clicks them. No install, backup or wipe executes. */
  openSettings(surface: HostMaintenanceSurface, signal?: AbortSignal): Promise<{ status: "opened"; surface: HostMaintenanceSurface }>;
};
