import { useCallback, useEffect } from "react";
import { useAtom } from "jotai";
import {
  canUseSoftwareUpdater,
  findSoftwareUpdate,
  installSoftwareUpdate,
  readCurrentAppVersion,
} from "../lib/software-update";
import { softwareUpdateAtom } from "../state/software-update";

let activeCheck: Promise<void> | null = null;
let activeInstall: Promise<void> | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useSoftwareUpdate() {
  const [state, setState] = useAtom(softwareUpdateAtom);
  const supported = canUseSoftwareUpdater();

  useEffect(() => {
    const handleInstallerOpened = () => {
      setState((previous) => ({ ...previous, phase: "installer-open", progress: null }));
    };
    window.addEventListener("ra-android-installer-opened", handleInstallerOpened);
    return () => window.removeEventListener("ra-android-installer-opened", handleInstallerOpened);
  }, [setState]);

  const loadCurrentVersion = useCallback(async () => {
    try {
      const currentVersion = await readCurrentAppVersion();
      if (currentVersion) {
        setState((previous) => ({ ...previous, currentVersion }));
      }
    } catch {
      // Version display is non-critical; update checks surface their own errors.
    }
  }, [setState]);

  const checkForUpdates = useCallback(async () => {
    if (!supported) return;
    if (activeCheck) return activeCheck;

    activeCheck = (async () => {
      setState((previous) => ({
        ...previous,
        phase: "checking",
        progress: null,
        error: null,
        errorStage: null,
      }));
      try {
        const update = await findSoftwareUpdate();
        if (!update) {
          setState((previous) => ({
            ...previous,
            phase: "up-to-date",
            availableVersion: null,
          }));
          return;
        }
        setState({
          phase: "available",
          currentVersion: update.currentVersion,
          availableVersion: update.version,
          progress: null,
          error: null,
          errorStage: null,
        });
      } catch (error) {
        setState((previous) => ({
          ...previous,
          phase: "error",
          error: errorMessage(error),
          errorStage: "check",
        }));
      } finally {
        activeCheck = null;
      }
    })();

    return activeCheck;
  }, [setState, supported]);

  const installUpdate = useCallback(async () => {
    if (!supported || activeInstall) return activeInstall ?? undefined;

    activeInstall = (async () => {
      setState((previous) => ({
        ...previous,
        phase: "downloading",
        progress: null,
        error: null,
        errorStage: null,
      }));
      try {
        const result = await installSoftwareUpdate(({ phase, progress }) => {
          setState((previous) => ({ ...previous, phase, progress }));
        });
        setState((previous) => ({
          ...previous,
          phase: result === "permission-required" ? "permission-required" : "installer-open",
          progress: null,
        }));
      } catch (error) {
        setState((previous) => ({
          ...previous,
          phase: "error",
          error: errorMessage(error),
          errorStage: "install",
        }));
      } finally {
        activeInstall = null;
      }
    })();

    return activeInstall;
  }, [setState, supported]);

  return {
    state,
    supported,
    loadCurrentVersion,
    checkForUpdates,
    installUpdate,
  };
}
