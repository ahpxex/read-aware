import { AppError, RESOURCE_LIFETIME_MS, type ResourceCreateOptions, type ResourcePickOptions, type ResourceRef } from "@read-aware/core";
import { open } from "@tauri-apps/plugin-dialog";
import { nativeResourceFiles } from "../platform/resource-files";
import { invoke } from "../platform/ipc";
import { isTauri, isMobileOS } from "../platform/environment";
import { createLogger } from "../platform/logger";
import { listLibraryBooks } from "../features/library/lib/library-db";
import { fileNameFromPath } from "../features/library/lib/pick-book-files";
import { ResourceOwner, type ResourceAdapter, type NativeResource } from "./resource-owner";

const log = createLogger("resources");
type NativeInfo = { id: string; size: number };
function desktop() {
  if (!isTauri() || isMobileOS()) throw new AppError("ui/unavailable", "File resources require the desktop app");
}
const release = nativeResourceFiles.release;
async function cleanup(values: NativeInfo[]) {
  for (const value of values) {
    try { await release(value.id); } catch (error) { log.warn("Resource cleanup failed", error); }
  }
}
export const resourceAdapter: ResourceAdapter = {
  async pick(options: ResourcePickOptions, signal) {
    desktop(); signal?.throwIfAborted();
    const selected = await open({ multiple: options.multiple ?? false, directory: false,
      ...(options.extensions?.length ? { filters: [{ name: "Files", extensions: options.extensions }] } : {}) });
    signal?.throwIfAborted();
    const paths = selected === null ? [] : Array.isArray(selected) ? selected : [selected];
    if (paths.length > 16) throw new AppError("ui/invalid-target", "Choose at most 16 files");
    const result: NativeResource[] = [];
    try {
      for (const path of paths) {
        signal?.throwIfAborted();
        const info = await invoke<NativeInfo>("resource_open_file", { path });
        result.push({ ...info, name: fileNameFromPath(path), mimeType: "application/octet-stream" });
      }
      signal?.throwIfAborted(); return result;
    } catch (error) { await cleanup(result); throw error; }
  },
  async openBook(bookId, signal) {
    desktop(); signal?.throwIfAborted();
    const book = (await listLibraryBooks()).find(book => book.id === bookId);
    if (!book) throw new AppError("reader/book-not-found", "Book not found");
    signal?.throwIfAborted();
    const info = await invoke<NativeInfo | null>("resource_open_book", { bookId });
    return info ? { ...info, name: fileNameFromPath(book.fileName || "book.bin"), mimeType: book.mimeType || "application/octet-stream" } : null;
  },
  async create(options: ResourceCreateOptions) {
    desktop();
    return { ...await nativeResourceFiles.create(), name: options.name, mimeType: options.mimeType ?? "application/octet-stream" };
  },
  read: nativeResourceFiles.read,
  append: nativeResourceFiles.append,
  commit: nativeResourceFiles.commit,
  async save(id, filename, signal) {
    desktop(); signal?.throwIfAborted();
    return nativeResourceFiles.save(id, filename, signal);
  },
  release,
};

export function createResourceOwner(authorizeBook?: (id: string) => void, authorizeRead?: (ref: ResourceRef) => void): ResourceOwner {
  return new ResourceOwner(resourceAdapter, error => log.warn("Resource cleanup failed", error), authorizeBook, Date.now, authorizeRead);
}

/** Agent handles are isolated by conversation, not shared with plugins or other threads. */
const agentOwners = new Map<string, { owner: ResourceOwner; usedAt: number }>();
export function agentResources(threadKey: string, bookId?: string): ResourceOwner {
  const now = Date.now();
  for (const [key, entry] of agentOwners) {
    if (now - entry.usedAt > RESOURCE_LIFETIME_MS) {
      agentOwners.delete(key);
      void entry.owner.dispose().catch(error => log.warn("Agent resource cleanup failed", error));
    }
  }
  const existing = agentOwners.get(threadKey);
  if (existing) { existing.usedAt = now; return existing.owner; }
  if (agentOwners.size >= 64) throw new AppError("ui/unavailable", "Too many active resource owners");
  const owner = createResourceOwner(id => {
    if (bookId !== undefined && id !== bookId) throw new AppError("memory/forbidden", "Resource belongs to another book");
  }, ref => {
    if (ref.source === "book") throw new AppError("memory/forbidden", "Original book resources are export-only for the Agent; read through the spoiler-aware book tools");
  });
  agentOwners.set(threadKey, { owner, usedAt: now }); return owner;
}
