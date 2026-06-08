import type { StorageAdapter } from "@read-aware/core";
import { TauriStorageAdapter } from "./tauri-storage";

/** True when running inside the Tauri desktop shell (vs a plain browser). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let adapter: StorageAdapter | null = null;

/**
 * Resolve the StorageAdapter for the current platform.
 * - Desktop (Tauri): SQLite + blob store via Rust commands.
 * - Browser: not yet implemented (planned: OPFS + wa-sqlite).
 */
export function getStorage(): StorageAdapter {
  if (adapter) return adapter;
  if (isTauri()) {
    adapter = new TauriStorageAdapter();
    return adapter;
  }
  throw new Error(
    "No StorageAdapter for this platform yet (browser OPFS + wa-sqlite adapter is not implemented).",
  );
}
