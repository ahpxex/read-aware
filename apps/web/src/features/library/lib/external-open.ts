import { invoke } from "../../../platform/ipc";
import { listen } from "@tauri-apps/api/event";
import { fileNameFromPath } from "./pick-book-files";
import type { BookImportSource } from "./library-types";

/**
 * OS "open with ReadAware" seam. Rust parks incoming document paths — launch
 * argv, second-instance argv, macOS Apple Events — in a queue
 * (`external_open.rs`) because they can arrive before the webview mounts.
 * These wrappers drain that queue and subscribe to its "new paths parked" ping.
 */

export async function takeExternalOpenPaths(): Promise<string[]> {
  return await invoke<string[]>("external_open_take");
}

export function onExternalOpenRequest(handler: () => void): () => void {
  const unlisten = listen("external-open-request", handler);
  return () => void unlisten.then((dispose) => dispose());
}

/** Lift drained paths into import sources (size via Rust; bytes stay native). */
export async function sourcesFromNativePaths(paths: string[]): Promise<BookImportSource[]> {
  return Promise.all(paths.map(async (path) => ({
    kind: "native-path" as const,
    path,
    name: fileNameFromPath(path),
    size: await invoke<number>("book_file_size", { path }),
  })));
}
