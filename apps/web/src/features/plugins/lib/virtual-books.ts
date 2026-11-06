import { causalActor, type DomainActor } from "../../../platform/domain-actor";
/**
 * The virtual-book registry: which shelf entries are plugin-provided, and by
 * which content provider. Book records live in the normal library store
 * (format "virtual"); this KV map carries the provider binding the reader
 * resolves at open time. Providers themselves register per activation into
 * the contribution store (disposed on disable, like every contribution).
 */
import { AppError, type EventOrigin } from "@read-aware/core";
import { afterLocalKVWrites, commitLocalKVTransaction, localKV } from "../../../platform/local-store";
import type { VirtualBookRef } from "../../reader/lib/reader-types";
import { invalidateBookContent } from "../../library/lib/content-invalidation";
import { getContentProvider, type RegisteredContentProvider } from "../state/plugin-store";

import { invoke } from "../../../platform/ipc";
import { runDomainWrite } from "../../../platform/domain-write-gate";
import { dispatchMinted, broadcastDomainEventDrafts, type DomainEventDraft } from "../../../platform/domain-events";
import { settled } from "../../../platform/write-settlement";

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
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.values(parsed).some(
      (value) =>
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        typeof value.pluginId !== "string" ||
        typeof value.providerId !== "string" ||
        typeof value.key !== "string",
    )
  ) {
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
    if (entry.pluginId === binding.pluginId && entry.providerId === binding.providerId && entry.key === binding.key) {
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

/** A provider announces already-saved source changes, never someone else's book. */
export async function invalidateOwnedVirtualBook(
  binding: VirtualBookBinding,
  exists: (bookId: string) => Promise<unknown>,
  signal?: AbortSignal,
  origin: DomainActor = "system",
): Promise<{ bookId: string; revision: string }> {
  origin = causalActor(origin);
  signal?.throwIfAborted();
  if (!binding.providerId.trim() || binding.providerId.length > 256 || !binding.key || binding.key.length > 8192) {
    throw new AppError("reader/invalid-target", "A provider and bounded content key are required");
  }
  const provider = resolveContentProvider(binding);
  if (!provider) throw new AppError("library/content-unavailable", "Content provider is not active");
  const bookId = await afterLocalKVWrites(() => findVirtualBookId(binding));
  if (!bookId || !(await exists(bookId)))
    throw new AppError("library/book-not-found", "Virtual book is not in the library");
  signal?.throwIfAborted();
  if (resolveContentProvider(binding) !== provider || findVirtualBookId(binding) !== bookId) {
    throw new AppError("library/content-unavailable", "Virtual book binding or provider changed");
  }
  return { bookId, revision: invalidateBookContent(bookId, origin) };
}

/** A failed deletion must keep its binding; cleanup failure is retryable, not success. */
export async function removeOwnedVirtualBook(
  binding: VirtualBookBinding,
  removeBook: (bookId: string) => Promise<void>,
  expectedBookId?: string,
): Promise<void> {
  const bookId = await afterLocalKVWrites(() => findVirtualBookId(binding));
  if (
    expectedBookId !== undefined &&
    (typeof expectedBookId !== "string" || !expectedBookId.trim() || expectedBookId.length > 256)
  )
    throw new AppError("plugin/invalid-argument", "Invalid expected virtual book ID");
  if (!bookId) return;
  if (expectedBookId !== undefined && bookId !== expectedBookId)
    throw new AppError("reader/superseded", "Virtual book binding changed since removal was requested");
  await removeBook(bookId);
  await unbindVirtualBookDurably(bookId, binding);
}

export function resolveContentProvider(binding: VirtualBookBinding): RegisteredContentProvider | null {
  return getContentProvider(binding.pluginId, binding.providerId);
}

/** Serialize same-binding creation/removal through receipt settlement, not just
 * the first registry lookup. Different providers can continue independently. */
const bindingTails = new Map<string, Promise<unknown>>();
export function withVirtualBookBinding<T>(binding: VirtualBookBinding, work: () => Promise<T>): Promise<T> {
  const key = JSON.stringify([binding.pluginId, binding.providerId, binding.key]);
  const result = settled(bindingTails.get(key) ?? Promise.resolve()).then(work);
  bindingTails.set(key, result);
  void settled(result).then(() => {
    if (bindingTails.get(key) === result) bindingTails.delete(key);
  });
  return result;
}

export async function commitBoundVirtualBook(
  bookId: string,
  binding: VirtualBookBinding,
  drafts: DomainEventDraft[],
  signal?: AbortSignal,
): Promise<void> {
  const origin: EventOrigin = `plugin:${binding.pluginId}`;
  return runDomainWrite(async () => {
    signal?.throwIfAborted();
    await dispatchMinted(drafts, (events) =>
      afterLocalKVWrites(() => {
        signal?.throwIfAborted();
        const expectedRegistry = localKV.getItem(REGISTRY_KEY),
          registry = readRegistry();
        if (registry[bookId] || findVirtualBookId(binding))
          throw new AppError("library/content-unavailable", "Virtual book binding changed");
        registry[bookId] = { ...binding };
        const replacementRegistry = JSON.stringify(registry);
        return commitLocalKVTransaction(
          new Map([[REGISTRY_KEY, replacementRegistry]]),
          async () => {
            signal?.throwIfAborted();
            await invoke("virtual_book_create", { bookId, binding, events, expectedRegistry, replacementRegistry });
          },
          origin,
        );
      }),
    );
    broadcastDomainEventDrafts(drafts);
  });
}

/** Run after local-store/legacy hydration and before plugin activation. Native
 * rechecks live books and the complete registry in the same write transaction. */
export async function recoverVirtualBookBindings(
  listBooks: () => Promise<{ id: string; format: string }[]>,
): Promise<number> {
  return runDomainWrite(async () => {
    const books = new Set((await listBooks()).filter((book) => book.format === "virtual").map((book) => book.id));
    return afterLocalKVWrites(async () => {
      const expectedRegistry = localKV.getItem(REGISTRY_KEY),
        registry = readRegistry();
      const bookIds = Object.keys(registry).filter((id) => !books.has(id));
      if (!bookIds.length) return 0;
      for (const id of bookIds) delete registry[id];
      const replacementRegistry = JSON.stringify(registry);
      await commitLocalKVTransaction(
        new Map([[REGISTRY_KEY, replacementRegistry]]),
        () => invoke("virtual_book_prune", { bookIds, expectedRegistry, replacementRegistry }),
        "system",
      );
      return bookIds.length;
    });
  });
}

export function unbindVirtualBookDurably(bookId: string, binding: VirtualBookBinding): Promise<void> {
  return afterLocalKVWrites(async () => {
    const registry = readRegistry();
    const current = registry[bookId];
    // The shared book-removed listener may already have durably cleaned it up.
    if (!current) return;
    if (
      current.pluginId !== binding.pluginId ||
      current.providerId !== binding.providerId ||
      current.key !== binding.key
    ) {
      throw new AppError("plugin/unavailable", "Virtual book binding changed during removal");
    }
    delete registry[bookId];
    await localKV.setItemAsync(REGISTRY_KEY, JSON.stringify(registry));
  });
}
