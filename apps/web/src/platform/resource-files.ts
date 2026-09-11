import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "./ipc";
import type { ResourceImageReceipt } from "@read-aware/core";
import { saveResourceFile } from "./resource-save";

/** Private native IDs stay in the host; actor APIs translate them to scoped references. */
export const nativeResourceFiles = {
  create: () => invoke<{ id: string; size: number }>("resource_create"),
  read: (id: string, offset: number, length: number) => invoke<ArrayBuffer>("resource_read", { id, offset, length }),
  append: (id: string, offset: number, data: Uint8Array) => invoke<number>("resource_append", data,
    { headers: { "x-resource-id": id, "x-resource-offset": String(offset) } }),
  commit: (id: string) => invoke<void>("resource_commit", { id }),
  commitContext: (id: string, expectedReadRevision: string) => invoke<void>("resource_commit_context", { id, expectedReadRevision }),
  release: (id: string) => invoke<void>("resource_release", { id }),
  copyImage: (id: string) => invoke<ResourceImageReceipt>("resource_copy_image", { id }),
  imagePreview: (id: string) => invoke<ArrayBuffer>("resource_image_preview", { id }),
  async save(id: string, filename: string, signal?: AbortSignal, beforeWrite?: () => void): Promise<boolean> {
    const extension = filename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    return saveResourceFile(() => save({ defaultPath: filename,
      ...(extension ? { filters: [{ name: `${extension.toUpperCase()} file`, extensions: [extension] }] } : {}) }),
    path => invoke("resource_save", { id, path }), signal, beforeWrite);
  },
};
