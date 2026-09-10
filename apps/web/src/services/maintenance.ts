import { getDefaultStore } from "jotai";
import { softwareUpdateAtom } from "../features/update/state/software-update";
import { softwareUpdater } from "../features/update/lib/software-update-runtime";
import { subscribeUpdateChannel } from "../features/update/lib/update-channel";
import { createLogger } from "../platform/logger";
import { HostMaintenanceService } from "./maintenance-controller";
import { workspace } from "./workspace";

const log = createLogger("maintenance");
export const hostMaintenance = new HostMaintenanceService({
  snapshot: () => softwareUpdater.snapshot(),
  check: signal => softwareUpdater.checkForUpdates(signal),
  subscribe: handler => {
    const state = getDefaultStore().sub(softwareUpdateAtom, handler), channel = subscribeUpdateChannel(handler);
    return () => { state(); channel(); };
  },
  navigate: (section, signal) => workspace.navigate({ surface: "settings", section }, undefined, signal),
}, error => log.warn("Maintenance observer failed", error));
