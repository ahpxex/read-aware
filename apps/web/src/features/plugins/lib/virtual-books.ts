/**
 * The virtual-book registry: which shelf entries are plugin-provided, and by
 * which content provider. Book records live in the normal library store
 * (format "virtual"); this KV map carries the provider binding the reader
 * resolves at open time. Providers themselves register per activation into
 * the contribution store (disposed on disable, like every contribution).
 */
import { atom, getDefaultStore } from "jotai";
import { localKV } from "../../../platform/local-store";
import type { VirtualBookRef } from "../../reader/lib/reader-types";
import type { VirtualBookContent } from "../../reader/lib/virtual-book";

const REGISTRY_KEY = "read-aware-virtual-books";

export type VirtualBookBinding = VirtualBookRef;

function readRegistry(): Record<string, VirtualBookBinding> {
  try {
    const raw = localKV.getItem(REGISTRY_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, VirtualBookBinding>)
      : {};
  } catch {
    return {};
  }
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

// ─── Content providers (live, per-activation) ────────────────────────────────

export type RegisteredContentProvider = {
  /** `${pluginId}:${providerId}` */
  key: string;
  pluginId: string;
  providerId: string;
  load: (bookKey: string) => Promise<VirtualBookContent>;
};

export const contentProvidersAtom = atom<RegisteredContentProvider[]>([]);

export function registerContentProviderContribution(
  provider: RegisteredContentProvider,
): { dispose: () => void } {
  const store = getDefaultStore();
  store.set(contentProvidersAtom, [
    ...store.get(contentProvidersAtom).filter((entry) => entry.key !== provider.key),
    provider,
  ]);
  let disposed = false;
  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      store.set(
        contentProvidersAtom,
        store.get(contentProvidersAtom).filter((entry) => entry.key !== provider.key),
      );
    },
  };
}

export function resolveContentProvider(
  binding: VirtualBookBinding,
): RegisteredContentProvider | null {
  return (
    getDefaultStore()
      .get(contentProvidersAtom)
      .find(
        (provider) =>
          provider.pluginId === binding.pluginId &&
          provider.providerId === binding.providerId,
      ) ?? null
  );
}
