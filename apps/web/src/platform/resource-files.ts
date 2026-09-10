import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "./ipc";
import type { ResourceImageReceipt } from "@read-aware/core";

/** Private native IDs stay in the host; actor APIs translate them to scoped references. */
export const nativeResourceFiles = {
  create: () => invoke<{ id: string; size: number }>("resource_create"),
  read: (id: string, offset: number, length: number) => invoke<ArrayBuffer>("resource_read", { id, offset, length }),
  append: (id: string, offset: number, data: Uint8Array) => invoke<number>("resource_append", data,
    { headers: { "x-resource-id": id, "x-resource-offset": String(offset) } }),
  commit: (id: string) => invoke<void>("resource_commit", { id }),
  release: (id: string) => invoke<void>("resource_release", { id }),
  copyImage: (id: string) => invoke<ResourceImageReceipt>("resource_copy_image", { id }),
  imagePreview: (id: string) => invoke<ArrayBuffer>("resource_image_preview", { id }),
  async save(id: string, filename: string, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted();
    const extension = filename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    const path = await save({ defaultPath: filename,
      ...(extension ? { filters: [{ name: `${extension.toUpperCase()} file`, extensions: [extension] }] } : {}) });
    signal?.throwIfAborted(); if (path === null) return false;
    await invoke("resource_save", { id, path }); return true;
  },
};
