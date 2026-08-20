import { isAndroid, isMobileOS, isTauri } from "../../../platform/environment";
import { resolveBetaManifestUrl } from "./release-feed";
import { getUpdateChannel } from "./update-channel";

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

async function invokeWithTimeout<T>(
  command: string,
  timeoutMs: number,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  let timer: number | undefined;
  try {
    return await Promise.race([
      invoke<T>(command, args),
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

/** Whether the last desktop check parked an update in Rust state. */
let desktopUpdateReady = false;

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

  // Beta: point the check at the semver-largest release's manifest (found via
  // the GitHub API); a failed resolution degrades to the stable endpoint, so
  // beta users are never worse off than stable ones. Stable: the endpoint
  // baked into tauri.conf.json (GitHub's `releases/latest`, no pre-releases).
  const beta = getUpdateChannel() === "beta";

  if (isAndroid()) {
    const manifestUrl = beta ? await resolveBetaManifestUrl("latest-android.json") : null;
    return invokeWithTimeout<AvailableSoftwareUpdate | null>(
      "android_update_check",
      ANDROID_CHECK_TIMEOUT_MS,
      { manifestUrl },
    );
  }

  desktopUpdateReady = false;
  const endpoint = beta ? await resolveBetaManifestUrl("latest.json") : null;
  const { invoke } = await import("@tauri-apps/api/core");
  const found = await invoke<AvailableSoftwareUpdate | null>("desktop_update_check", { endpoint });
  desktopUpdateReady = found !== null;
  return found;
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

  if (!desktopUpdateReady) throw new Error("No software update is ready to install.");

  onProgress({ phase: "downloading", progress: null });
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<{ downloaded: number; total: number | null; finished: boolean }>(
    "ra-desktop-update-progress",
    (event) => {
      const { downloaded, total, finished } = event.payload;
      if (finished) {
        onProgress({ phase: "installing", progress: 100 });
        return;
      }
      onProgress({
        phase: "downloading",
        progress: total ? Math.min(100, Math.round((downloaded / total) * 100)) : null,
      });
    },
  );

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("desktop_update_install");
  } finally {
    unlisten();
  }

  desktopUpdateReady = false;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
  return "installer-started";
}
