/**
 * The virtual-book registry: which shelf entries are plugin-provided, and by
 * which content provider. Book records live in the normal library store
 * (format "virtual"); this KV map carries the provider binding the reader
 * resolves at open time. Providers themselves register per activation into
 * the contribution store (disposed on disable, like every contribution).
 */
import { AppError } from "@read-aware/core";
import { afterLocalKVWrites, localKV } from "../../../platform/local-store";
import type { VirtualBookRef } from "../../reader/lib/reader-types";
import {
  getContentProvider,
  type RegisteredContentProvider,
} from "../state/plugin-store";

const REGISTRY_KEY = "read-aware-virtual-books";

export type VirtualBookBinding = VirtualBookRef;

function readRegistry(): Record<string, VirtualBookBinding> {
  const raw = localKV.getItem(REGISTRY_KEY);
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError("db/error", "Virtual book registry is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
    || Object.values(parsed).some(value => typeof value !== "object" || value === null || Array.isArray(value)
      || typeof value.pluginId !== "string" || typeof value.providerId !== "string" || typeof value.key !== "string")) {
    throw new AppError("db/error", "Virtual book registry has invalid bindings");
  }
  return parsed as Record<string, VirtualBookBinding>;
}

export function getVirtualBookBinding(bookId: string): VirtualBookBinding | null {
  return readRegistry()[bookId] ?? null;
}

export function findVirtualBookId(binding: VirtualBookBinding): string | null {
  const registry = readRegistry();
  for (const [bookId, entry] of Object.entries(registry)) {
    if (
      entry.pluginId === binding.pluginId &&
      entry.providerId === binding.providerId &&
      entry.key === binding.key
    ) {
      return bookId;
    }
  }
  return null;
}

export function bindVirtualBook(bookId: string, binding: VirtualBookBinding): void {
  const registry = readRegistry();
  registry[bookId] = binding;
  localKV.setItem(REGISTRY_KEY, JSON.stringify(registry));
}

export function unbindVirtualBook(bookId: string): void {
  const registry = readRegistry();
  delete registry[bookId];
  localKV.setItem(REGISTRY_KEY, JSON.stringify(registry));
}

/** A failed deletion must keep its binding; cleanup failure is retryable, not success. */
export async function removeOwnedVirtualBook(
  binding: VirtualBookBinding,
  removeBook: (bookId: string) => Promise<void>,
): Promise<void> {
  const bookId = await afterLocalKVWrites(() => findVirtualBookId(binding));
  if (!bookId) return;
  await removeBook(bookId);
  await afterLocalKVWrites(async () => {
    const registry = readRegistry();
    const current = registry[bookId];
    // The shared book-removed listener may already have durably cleaned it up.
    if (!current) return;
    if (current.pluginId !== binding.pluginId || current.providerId !== binding.providerId || current.key !== binding.key) {
      throw new AppError("plugin/unavailable", "Virtual book binding changed during removal");
    }
    delete registry[bookId];
    await localKV.setItemAsync(REGISTRY_KEY, JSON.stringify(registry));
  });
}

export function resolveContentProvider(
  binding: VirtualBookBinding,
): RegisteredContentProvider | null {
  return getContentProvider(binding.pluginId, binding.providerId);
}
