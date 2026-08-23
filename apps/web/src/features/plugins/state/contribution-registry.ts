import { atom, getDefaultStore, type PrimitiveAtom } from "jotai";
import type { ContributionKey, PluginDisposable } from "../lib/plugin-types";

export type ContributionIdentity = {
  key: ContributionKey;
  pluginId: string;
};

export type ContributionPoint =
  | "selection-actions"
  | "header-actions"
  | "reader-modes"
  | "commands"
  | "agent-tools"
  | "themes"
  | "fonts"
  | "voice-providers"
  | "settings-options"
  | "content-providers";

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
  update(key: ContributionKey, update: (item: T) => T): void;
};

type InspectableRegistry = {
  point: ContributionPoint;
  list(): ContributionIdentity[];
};

const registries = new Map<ContributionPoint, InspectableRegistry>();

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
  const registry: ContributionRegistry<T> = {
    point,
    atom: entriesAtom,
    register(item) {
      validateIdentity(item);
      store.set(entriesAtom, [
        ...store.get(entriesAtom).filter((entry) => entry.key !== item.key),
        item,
      ]);
      let disposed = false;
      return {
        dispose: () => {
          if (disposed) return;
          disposed = true;
          store.set(
            entriesAtom,
            store
              .get(entriesAtom)
              .filter((entry) => entry.key !== item.key || entry !== item),
          );
        },
      };
    },
    list: () => store.get(entriesAtom),
    find: (predicate) => store.get(entriesAtom).find(predicate) ?? null,
    update: (key, update) => {
      store.set(
        entriesAtom,
        store
          .get(entriesAtom)
          .map((entry) => (entry.key === key ? update(entry) : entry)),
      );
    },
  };
  if (catalog) {
    registries.set(point, { point, list: () => registry.list() });
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
