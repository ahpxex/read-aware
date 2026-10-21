import { pickResourceFiles } from "../platform/pick-resource-files";
import {
  AppError,
  RESOURCE_LIFETIME_MS,
  type ResourceCreateOptions,
  type ResourcePickOptions,
  type ResourceRef,
} from "@read-aware/core";
import { open } from "@tauri-apps/plugin-dialog";
import { nativeResourceFiles } from "../platform/resource-files";
import { invoke } from "../platform/ipc";
import { isTauri, isMobileOS } from "../platform/environment";
import { createLogger } from "../platform/logger";
import { listLibraryBooks } from "../features/library/lib/library-db";
import { fileNameFromPath } from "../features/library/lib/pick-book-files";
import { ResourceOwner, type ResourceAdapter, type NativeResource } from "./resource-owner";
import { openAssociatedResource } from "../platform/resource-external";

const log = createLogger("resources");
type NativeInfo = { id: string; size: number };
function desktop() {
  if (!isTauri() || isMobileOS()) throw new AppError("ui/unavailable", "File resources require the desktop app");
}
const release = nativeResourceFiles.release;
async function cleanup(values: NativeInfo[]) {
  for (const value of values) {
    try {
      await release(value.id);
    } catch (error) {
      log.warn("Resource cleanup failed", error);
    }
  }
}
export const resourceAdapter: ResourceAdapter = {
  supported: () => isTauri(),
  directories: {
    async pick(signal) {
      desktop();
      signal?.throwIfAborted();
      const path = await open({ multiple: false, directory: true });
      signal?.throwIfAborted();
      if (path === null) return null;
      if (typeof path !== "string") throw new AppError("ui/invalid-target", "Choose one directory");
      const id = await invoke<string>("resource_open_directory", { path });
      return { id, name: fileNameFromPath(path.replace(/[\\/]+$/, "")) || "Directory" };
    },
    list: (id, query) => invoke("resource_list_directory", { id, query }),
    async openFile(id, relativePath) {
      const info = await invoke<NativeInfo>("resource_open_directory_file", { id, relativePath });
      return { ...info, name: relativePath.split("/").at(-1)!, mimeType: "application/octet-stream" };
    },
    release: (id) => invoke("resource_release_directory", { id }),
  },
  async pick(options: ResourcePickOptions, signal) {
    if (!isTauri()) throw new AppError("ui/unavailable", "File resources require the native app");
    const paths = await pickResourceFiles(options, signal);
    if (paths.length > 16) throw new AppError("ui/invalid-target", "Choose at most 16 files");
    const extensions = options.extensions?.map((extension) => extension.toLowerCase());
    if (
      extensions?.length &&
      paths.some(({ name }) => !extensions.some((ext) => name.toLowerCase().endsWith(`.${ext}`)))
    ) {
      throw new AppError("ui/invalid-target", "Selected file does not match the requested extensions");
    }
    const result: NativeResource[] = [];
    try {
      for (const { path, name } of paths) {
        signal?.throwIfAborted();
        const info = await invoke<NativeInfo>("resource_open_file", { path });
        result.push({ ...info, name, mimeType: "application/octet-stream" });
      }
      signal?.throwIfAborted();
      return result;
    } catch (error) {
      await cleanup(result);
      throw error;
    }
  },
  async openBook(bookId, signal) {
    desktop();
    signal?.throwIfAborted();
    const book = (await listLibraryBooks()).find((book) => book.id === bookId);
    if (!book) throw new AppError("reader/book-not-found", "Book not found");
    signal?.throwIfAborted();
    const info = await invoke<NativeInfo | null>("resource_open_book", { bookId });
    return info
      ? {
          ...info,
          name: fileNameFromPath(book.fileName || "book.bin"),
          mimeType: book.mimeType || "application/octet-stream",
        }
      : null;
  },
  async create(options: ResourceCreateOptions) {
    desktop();
    return {
      ...(await nativeResourceFiles.create()),
      name: options.name,
      mimeType: options.mimeType ?? "application/octet-stream",
    };
  },
  async openCover(bookId, signal) {
    desktop();
    signal?.throwIfAborted();
    const info = await invoke<(NativeInfo & { mimeType: string }) | null>("resource_open_cover", { bookId });
    if (!info) return null;
    const extension =
      (
        {
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/webp": "webp",
          "image/gif": "gif",
          "image/bmp": "bmp",
        } as Record<string, string>
      )[info.mimeType] ?? "bin";
    return { ...info, name: `cover.${extension}` };
  },
  read: nativeResourceFiles.read,
  append: nativeResourceFiles.append,
  commit: nativeResourceFiles.commit,
  commitContext: nativeResourceFiles.commitContext,
  async save(id, filename, signal, beforeWrite) {
    desktop();
    signal?.throwIfAborted();
    return nativeResourceFiles.save(id, filename, signal, beforeWrite);
  },
  release,
  openAssociated: openAssociatedResource,
  copyImage: nativeResourceFiles.copyImage,
  imagePreview: nativeResourceFiles.imagePreview,
};

export function createResourceOwner(
  authorizeBook?: (id: string) => void,
  authorizeRead?: (ref: ResourceRef, bookId?: string) => void,
): ResourceOwner {
  return new ResourceOwner(
    resourceAdapter,
    (error) => log.warn("Resource cleanup failed", error),
    authorizeBook,
    Date.now,
    authorizeRead,
  );
}

/** Bytes the model may read: books stay behind the spoiler-aware tools, context bundles behind their fence-checked read. */
export function agentResourceReadPolicy(ref: ResourceRef): void {
  if (ref.source === "book")
    throw new AppError(
      "memory/forbidden",
      "Original book resources are export-only for the Agent; read through the spoiler-aware book tools",
    );
  if (ref.source === "context")
    throw new AppError(
      "memory/forbidden",
      "Context bundle resources are export-only for the Agent; read through read_context_bundle",
    );
}

/** Agent handles are isolated by conversation, not shared with plugins or other threads. */
const agentOwners = new Map<string, { owner: ResourceOwner; usedAt: number }>();
export function agentResources(threadKey: string, bookId?: string): ResourceOwner {
  const now = Date.now();
  for (const [key, entry] of agentOwners) {
    if (now - entry.usedAt > RESOURCE_LIFETIME_MS) {
      agentOwners.delete(key);
      void entry.owner.dispose().catch((error) => log.warn("Agent resource cleanup failed", error));
    }
  }
  const existing = agentOwners.get(threadKey);
  if (existing) {
    existing.usedAt = now;
    return existing.owner;
  }
  if (agentOwners.size >= 64) throw new AppError("ui/unavailable", "Too many active resource owners");
  const owner = createResourceOwner((id) => {
    if (bookId !== undefined && id !== bookId)
      throw new AppError("memory/forbidden", "Resource belongs to another book");
  }, agentResourceReadPolicy);
  agentOwners.set(threadKey, { owner, usedAt: now });
  return owner;
}
