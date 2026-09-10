/** Opaque, activation/thread-local reference. Never a path or native storage key. */
export type ResourceRef = {
  id: string; name: string; mimeType: string; size: number;
  state: "writing" | "ready"; expiresAt: number;
  source: "picked" | "created" | "book" | "cover" | "image";
};
export type ResourcePickOptions = { multiple?: boolean; extensions?: string[] };
export type ResourceCreateOptions = { name: string; mimeType?: string };
export type ResourceChunk = { data: ArrayBuffer; nextOffset: number; eof: boolean };
export type ResourceImageReceipt = { copied: true; width: number; height: number };
export type ResourcePort = {
  pick(options?: ResourcePickOptions, signal?: AbortSignal): Promise<{ cancelled: boolean; resources: ResourceRef[] }>;
  /** Returns null for a book with no locally available original file. Never fetches it remotely. */
  openBook(bookId: string, signal?: AbortSignal): Promise<ResourceRef | null>;
  /** Local cover snapshot; null means not locally available. Does not generate or download covers. */
  openCover(bookId: string, signal?: AbortSignal): Promise<ResourceRef | null>;
  create(options: ResourceCreateOptions, signal?: AbortSignal): Promise<ResourceRef>;
  stat(id: string, signal?: AbortSignal): Promise<ResourceRef>;
  read(id: string, offset: number, length: number, signal?: AbortSignal): Promise<ResourceChunk>;
  append(id: string, offset: number, data: Uint8Array | ArrayBuffer, signal?: AbortSignal): Promise<ResourceRef>;
  commit(id: string, signal?: AbortSignal): Promise<ResourceRef>;
  save(id: string, filename?: string, signal?: AbortSignal): Promise<{ saved: boolean }>;
  /** Decode a sealed image in the host and replace the image clipboard. No bytes enter the model. */
  copyImage(id: string, signal?: AbortSignal): Promise<ResourceImageReceipt>;
  /** Aborts an unfinished writer or releases a sealed reference. Both are idempotent. */
  release(id: string): Promise<void>;
};
export const RESOURCE_MAX_CHUNK = 1024 * 1024;
export const RESOURCE_MAX_SIZE = 1024 * 1024 * 1024;
export const RESOURCE_LIFETIME_MS = 60 * 60 * 1000;
