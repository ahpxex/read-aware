import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { isAndroid, isMobileOS, isTauri } from "../../../platform/environment";

export type AvailableSoftwareUpdate = {
  currentVersion: string;
  version: string;
};

export type DownloadProgress = {
  phase: "downloading" | "installing";
  progress: number | null;
};

export type InstallSoftwareUpdateResult = "installer-started" | "permission-required";

// The Rust commands bound their own network timeouts (15s manifest / 300s APK),
// so these only fire if the invoke response itself is lost — a real Android IPC
// failure mode (and, historically, a panicked command). Without them the UI
// would sit on "checking"/"downloading" forever with no way to retry.
const ANDROID_CHECK_TIMEOUT_MS = 45_000;
const ANDROID_INSTALL_TIMEOUT_MS = 6 * 60_000;

async function invokeWithTimeout<T>(command: string, timeoutMs: number): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  let timer: number | undefined;
  try {
    return await Promise.race([
      invoke<T>(command),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(
          () => reject(new Error("The update service did not respond in time.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

let pendingUpdate: Update | null = null;

export function canUseSoftwareUpdater(): boolean {
  return isTauri() && (isAndroid() || !isMobileOS());
}

export async function readCurrentAppVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

export async function findSoftwareUpdate(): Promise<AvailableSoftwareUpdate | null> {
  if (!canUseSoftwareUpdater()) return null;

  if (isAndroid()) {
    return invokeWithTimeout<AvailableSoftwareUpdate | null>(
      "android_update_check",
      ANDROID_CHECK_TIMEOUT_MS,
    );
  }

  if (pendingUpdate) {
    await pendingUpdate.close();
    pendingUpdate = null;
  }

  const { check } = await import("@tauri-apps/plugin-updater");
  pendingUpdate = await check({ timeout: 15_000 });
  if (!pendingUpdate) return null;

  return {
    currentVersion: pendingUpdate.currentVersion,
    version: pendingUpdate.version,
  };
}

export async function installSoftwareUpdate(
  onProgress: (progress: DownloadProgress) => void,
): Promise<InstallSoftwareUpdateResult> {
  if (isAndroid()) {
    onProgress({ phase: "downloading", progress: null });
    return invokeWithTimeout<InstallSoftwareUpdateResult>(
      "android_update_install",
      ANDROID_INSTALL_TIMEOUT_MS,
    );
  }

  if (!pendingUpdate) throw new Error("No software update is ready to install.");

  let downloaded = 0;
  let contentLength: number | undefined;

  await pendingUpdate.downloadAndInstall((event: DownloadEvent) => {
    switch (event.event) {
      case "Started":
        downloaded = 0;
        contentLength = event.data.contentLength;
        onProgress({ phase: "downloading", progress: contentLength ? 0 : null });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress({
          phase: "downloading",
          progress: contentLength
            ? Math.min(100, Math.round((downloaded / contentLength) * 100))
            : null,
        });
        break;
      case "Finished":
        onProgress({ phase: "installing", progress: 100 });
        break;
    }
  });

  pendingUpdate = null;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
  return "installer-started";
}
