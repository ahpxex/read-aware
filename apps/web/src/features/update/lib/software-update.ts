import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { isMobileOS, isTauri } from "../../../platform/environment";

export type AvailableSoftwareUpdate = {
  currentVersion: string;
  version: string;
};

export type DownloadProgress = {
  phase: "downloading" | "installing";
  progress: number | null;
};

let pendingUpdate: Update | null = null;

export function canUseSoftwareUpdater(): boolean {
  return isTauri() && !isMobileOS();
}

export async function readCurrentAppVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

export async function findSoftwareUpdate(): Promise<AvailableSoftwareUpdate | null> {
  if (!canUseSoftwareUpdater()) return null;

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
): Promise<void> {
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
}
