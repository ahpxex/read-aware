export type HostUpdatePhase = "idle" | "checking" | "up-to-date" | "available" | "downloading"
  | "installing" | "permission-required" | "installer-open" | "error";
export type HostUpdateState = {
  phase: HostUpdatePhase;
  currentVersion: string | null;
  availableVersion: string | null;
  progress: number | null;
  errorStage: "check" | "install" | null;
};
export type HostMaintenanceSurface = "updates" | "diagnostics";
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
  /** Reveals native controls. No diagnostics, paths, logs or report contents leave the host. */
  openSettings(surface: HostMaintenanceSurface, signal?: AbortSignal): Promise<{ status: "opened"; surface: HostMaintenanceSurface }>;
};
