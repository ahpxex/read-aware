import { getDefaultStore } from "jotai";
import { createLogger } from "../../../platform/logger";
import { softwareUpdateAtom } from "../state/software-update";
import { canUseSoftwareUpdater, findSoftwareUpdate, installSoftwareUpdate, readCurrentAppVersion } from "./software-update";
import { SoftwareUpdateController } from "./software-update-controller";
import { getUpdateChannel, subscribeUpdateChannel } from "./update-channel";

const store = getDefaultStore(), log = createLogger("update");
export const softwareUpdater = new SoftwareUpdateController({
  supported: canUseSoftwareUpdater, channel: getUpdateChannel,
  read: () => store.get(softwareUpdateAtom), write: state => store.set(softwareUpdateAtom, state),
  version: readCurrentAppVersion, check: findSoftwareUpdate, install: installSoftwareUpdate,
}, (message, error) => log.error(message, error));

const unsubscribe = subscribeUpdateChannel(() => softwareUpdater.channelChanged());
const installerOpened = () => softwareUpdater.installerOpened();
if (typeof window !== "undefined") window.addEventListener("ra-android-installer-opened", installerOpened);
if (import.meta.hot) import.meta.hot.dispose(() => {
  unsubscribe();
  if (typeof window !== "undefined") window.removeEventListener("ra-android-installer-opened", installerOpened);
});
