import { useAtomValue } from "jotai";
import { softwareUpdateAtom } from "../state/software-update";
import { canUseSoftwareUpdater } from "../lib/software-update";
import { softwareUpdater } from "../lib/software-update-runtime";
import { createLogger } from "../../../platform/logger";

const log = createLogger("update");
const loadCurrentVersion = () => softwareUpdater.loadCurrentVersion();
const checkForUpdates = async () => {
  if (!canUseSoftwareUpdater()) return;
  try { await softwareUpdater.checkForUpdates(); }
  catch { /* The shared controller logs and publishes the persistent check error. */ }
};
const installUpdate = async () => {
  try { await softwareUpdater.installUpdate(); }
  catch (error) { log.warn("Update installation was not dispatched", error); }
};

export function useSoftwareUpdate() {
  return { state: useAtomValue(softwareUpdateAtom), supported: canUseSoftwareUpdater(),
    loadCurrentVersion, checkForUpdates, installUpdate };
}
