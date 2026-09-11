import { invoke } from "../../../platform/ipc";
import { listen } from "@tauri-apps/api/event";
import { fileNameFromPath } from "./pick-book-files";
import type { BookImportSource } from "./library-types";
import { createLogger } from "../../../platform/logger";

const log = createLogger("external-open");

/**
 * OS "open with ReadAware" seam. Rust parks incoming document paths — launch
 * argv, second-instance argv, macOS Apple Events — in a queue
 * (`external_open.rs`) because they can arrive before the webview mounts.
 * These wrappers drain that queue and subscribe to its "new paths parked" ping.
 */

export type ExternalOpenBatch = { epoch: string; paths: string[] };

export async function takeExternalOpenPaths(): Promise<ExternalOpenBatch> {
  return await invoke<ExternalOpenBatch>("external_open_take");
}

export async function isExternalOpenBatchCurrent(batch: ExternalOpenBatch): Promise<boolean> {
  return await invoke<boolean>("external_open_is_current", { epoch: batch.epoch });
}

export function onExternalOpenRequest(handler: () => void, onError: (error: unknown) => void): () => void {
  let disposed = false;
  const unlisten = listen("external-open-request", handler).catch(error => {
    log.warn("Subscribing to external file requests failed", error);
    if (!disposed) onError(error);
    return undefined;
  });
  return () => {
    disposed = true;
    void unlisten.then(dispose => dispose?.()).catch(error => log.warn("Releasing external file subscription failed", error));
  };
}

/** Lift drained paths into import sources (size via Rust; bytes stay native). */
export async function sourcesFromNativePaths(paths: string[], epoch: string): Promise<BookImportSource[]> {
  return Promise.all(paths.map(async (path) => ({
    kind: "native-path" as const,
    path,
    externalOpenEpoch: epoch,
    name: fileNameFromPath(path),
    size: await invoke<number>("book_file_size", { path }),
  })));
}
