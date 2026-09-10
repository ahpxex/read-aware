import { getDefaultStore } from "jotai";
import { softwareUpdateAtom } from "../features/update/state/software-update";
import { softwareUpdater } from "../features/update/lib/software-update-runtime";
import { subscribeUpdateChannel } from "../features/update/lib/update-channel";
import { createLogger } from "../platform/logger";
import { HostMaintenanceService } from "./maintenance-controller";
import { workspace } from "./workspace";
import { AppError, type BackupAction } from "@read-aware/core";
import { HostActionFlow } from "./host-action-flow";
import { isTauri } from "../platform/environment";

const log = createLogger("maintenance");
export const hostBackupFlows = new HostActionFlow<{ action: BackupAction }, "imported" | "exported">({
  navigate: async signal => {
    if (!isTauri()) throw new AppError("ui/unavailable", "Backup requires the desktop app");
    await workspace.navigate({ surface: "settings", section: "dataSync" }, undefined, signal);
  },
  normalize: input => {
    if (!input || (input.action !== "import" && input.action !== "export")) throw new AppError("ui/invalid-target", "Invalid backup action");
    return { action: input.action };
  },
  completion: (action, result) => {
    if (action === "export" && typeof result === "boolean") return result ? "exported" : "cancelled";
    if (action === "import" && result === null) return "cancelled";
    if (action === "import" && result && typeof result === "object"
      && ["books", "collections", "annotations", "settings"].every(key => {
        const value = (result as Record<string, unknown>)[key];
        return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
      })) return "imported";
    throw new AppError("internal", "Invalid native backup completion");
  },
});
export const hostMaintenance = new HostMaintenanceService({
  requestBackup: (action, signal) => hostBackupFlows.request({ action }, signal),
  snapshot: () => softwareUpdater.snapshot(),
  check: signal => softwareUpdater.checkForUpdates(signal),
  subscribe: handler => {
    const state = getDefaultStore().sub(softwareUpdateAtom, handler), channel = subscribeUpdateChannel(handler);
    return () => { state(); channel(); };
  },
  navigate: (section, signal) => workspace.navigate({ surface: "settings", section }, undefined, signal),
}, error => log.warn("Maintenance observer failed", error));
