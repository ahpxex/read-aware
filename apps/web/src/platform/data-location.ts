import { AppError, errorCode, isRetryable } from "@read-aware/core";
import { appDataDir } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { isMobileOS, isTauri } from "./environment";

async function nativeCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const detail = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
      ? error.message : String(error);
    throw new AppError(errorCode(error) ?? "ipc/unknown", `Native data directory operation failed: ${detail}`, {
      cause: error, retryable: isRetryable(error),
    });
  }
}

/** Host-only. Uses the same app_data_dir resolver as storage::init_db. */
export const nativeDataLocation = {
  supported: () => isTauri() && !isMobileOS(),
  async read(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    if (!nativeDataLocation.supported()) throw new AppError("ui/unavailable", "Data directory requires the desktop app");
    const path = await nativeCall(appDataDir);
    signal?.throwIfAborted();
    if (typeof path !== "string" || !path.trim()) throw new AppError("internal", "Native app data directory is empty");
    return path;
  },
  async reveal(signal?: AbortSignal): Promise<void> {
    // No caller-supplied path; cancellation before dispatch cannot open a folder.
    const path = await nativeDataLocation.read(signal);
    signal?.throwIfAborted();
    await nativeCall(() => revealItemInDir(path));
    signal?.throwIfAborted();
  },
};
