import { atom, getDefaultStore, type PrimitiveAtom } from "jotai";
import { createLogger } from "../../../platform/logger";
import type { ContributionId } from "@read-aware/core";
import type { ContributionKey, PluginDisposable } from "../lib/plugin-types";

export type ContributionIdentity = {
  key: ContributionKey;
  pluginId: string;
};

export type ContributionPoint = ContributionId;

export type ContributionSnapshot = {
  point: ContributionPoint;
  key: ContributionKey;
  pluginId: string;
};

export type ContributionRegistry<T extends ContributionIdentity> = {
  readonly point: ContributionPoint;
  readonly atom: PrimitiveAtom<T[]>;
  register(item: T): PluginDisposable;
  list(): T[];
  find(predicate: (item: T) => boolean): T | null;
  update(key: ContributionKey, update: (item: T) => T): T | null;
};

type InspectableRegistry = {
  point: ContributionPoint;
  list(): ContributionIdentity[];
};

const registries = new Map<ContributionPoint, InspectableRegistry>();
const listeners = new Set<() => void>();
const log = createLogger("contribution-registry");

/** Registry changes only; observers never receive provider objects or callbacks. */
export function subscribeContributions(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function validateIdentity(item: ContributionIdentity): void {
  const pluginId = String(item.pluginId).trim();
  if (!pluginId || !String(item.key).startsWith(`${pluginId}:`)) {
    throw new Error(`contribution key must be owned by plugin "${pluginId}"`);
  }
}

/** Shared ownership, replacement, disposal, and inspection for every point. */
export function createContributionRegistry<T extends ContributionIdentity>(
  point: ContributionPoint,
  options: { catalog?: boolean } = {},
): ContributionRegistry<T> {
  const catalog = options.catalog !== false;
  if (catalog && registries.has(point)) {
    throw new Error(`contribution point is already registered: ${point}`);
  }
  const entriesAtom = atom<T[]>([]);
  const store = getDefaultStore();
  const owners = new Map<ContributionKey, symbol>();
  const registry: ContributionRegistry<T> = {
    point,
    atom: entriesAtom,
    register(item) {
      validateIdentity(item);
      const owner = Symbol(item.key);
      owners.set(item.key, owner);
      store.set(entriesAtom, [
        ...store.get(entriesAtom).filter((entry) => entry.key !== item.key),
        item,
      ]);
      let disposed = false;
      return {
        dispose: () => {
          if (disposed) return;
          disposed = true;
          if (owners.get(item.key) !== owner) return;
          owners.delete(item.key);
          store.set(
            entriesAtom,
            store
              .get(entriesAtom)
              .filter((entry) => entry.key !== item.key),
          );
        },
      };
    },
    list: () => store.get(entriesAtom),
    find: (predicate) => store.get(entriesAtom).find(predicate) ?? null,
    update: (key, update) => {
      let updated: T | null = null;
      store.set(
        entriesAtom,
        store
          .get(entriesAtom)
          .map((entry) => {
            if (entry.key !== key) return entry;
            updated = update(entry);
            if (updated.key !== entry.key || updated.pluginId !== entry.pluginId) {
              throw new Error("Contribution updates cannot transfer registration ownership");
            }
            return updated;
          }),
      );
      return updated;
    },
  };
  if (catalog) {
    registries.set(point, { point, list: () => registry.list() });
    store.sub(entriesAtom, () => {
      for (const notify of [...listeners]) {
        try { notify(); } catch (error) { log.warn("Contribution observer failed", error); }
      }
    });
  }
  return registry;
}

export function inspectContributions(pluginId?: string): ContributionSnapshot[] {
  return [...registries.values()].flatMap((registry) =>
    registry
      .list()
      .filter((entry) => !pluginId || entry.pluginId === pluginId)
      .map((entry) => ({
        point: registry.point,
        key: entry.key,
        pluginId: entry.pluginId,
      })),
  );
}
