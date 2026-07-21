/**
 * The contribution registries — the app-side heart of the plugin system.
 *
 * Jotai atoms on the default store so both worlds reach the same state: the
 * plugin host (non-React, during activate/deactivate) registers and disposes
 * contributions imperatively; surfaces subscribe with `useAtomValue` and update
 * reactively, which is what makes enable/disable instant.
 */
import { atom, getDefaultStore, type PrimitiveAtom } from "jotai";
import { localKV } from "../../../platform/local-store";
import type {
  ContributionKey,
  InstalledPlugin,
  PluginDisposable,
  PluginView,
  RegisteredCommand,
  RegisteredHeaderAction,
  RegisteredSelectionAction,
  RegisteredTool,
} from "../lib/plugin-types";

const store = getDefaultStore();

// ─── Contribution registries ─────────────────────────────────────────────────

export const selectionActionsAtom = atom<RegisteredSelectionAction[]>([]);
export const headerActionsAtom = atom<RegisteredHeaderAction[]>([]);
export const pluginCommandsAtom = atom<RegisteredCommand[]>([]);
export const pluginToolsAtom = atom<RegisteredTool[]>([]);

/** Installed plugins (manifest + enabled + activation error), for settings. */
export const installedPluginsAtom = atom<InstalledPlugin[]>([]);

function register<T extends { key: ContributionKey }>(
  target: PrimitiveAtom<T[]>,
  item: T,
): PluginDisposable {
  // Re-registering a key replaces the stale entry (e.g. a hot re-activation).
  store.set(target, [
    ...store.get(target).filter((existing) => existing.key !== item.key),
    item,
  ]);
  let disposed = false;
  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      store.set(
        target,
        store.get(target).filter((existing) => existing.key !== item.key),
      );
    },
  };
}

export function registerSelectionActionContribution(
  item: RegisteredSelectionAction,
): PluginDisposable {
  return register(selectionActionsAtom, item);
}

export function registerHeaderActionContribution(
  item: RegisteredHeaderAction,
): PluginDisposable {
  return register(headerActionsAtom, item);
}

export function registerCommandContribution(item: RegisteredCommand): PluginDisposable {
  return register(pluginCommandsAtom, item);
}

export function registerToolContribution(item: RegisteredTool): PluginDisposable {
  return register(pluginToolsAtom, item);
}

/** Snapshot of the enabled plugins' agent tools (read per agent build). */
export function getRegisteredPluginTools(): RegisteredTool[] {
  return store.get(pluginToolsAtom);
}

export function setInstalledPlugins(plugins: InstalledPlugin[]): void {
  store.set(installedPluginsAtom, plugins);
}

export function updateInstalledPlugin(
  id: string,
  patch: Partial<Omit<InstalledPlugin, "manifest">>,
): void {
  store.set(
    installedPluginsAtom,
    store
      .get(installedPluginsAtom)
      .map((plugin) => (plugin.manifest.id === id ? { ...plugin, ...patch } : plugin)),
  );
}

// ─── Enabled state (persisted) ───────────────────────────────────────────────

const ENABLED_KEY = "read-aware-plugins-enabled";

function readEnabledMap(): Record<string, boolean> {
  try {
    const raw = localKV.getItem(ENABLED_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** Manually dropped folders start disabled; installing through the app opts in. */
export function isPluginEnabled(id: string): boolean {
  return readEnabledMap()[id] === true;
}

export function persistPluginEnabled(id: string, enabled: boolean): void {
  const map = readEnabledMap();
  map[id] = enabled;
  localKV.setItem(ENABLED_KEY, JSON.stringify(map));
}

export function forgetPluginEnabled(id: string): void {
  const map = readEnabledMap();
  delete map[id];
  localKV.setItem(ENABLED_KEY, JSON.stringify(map));
}

// ─── Placement (user-owned pinning; docs/plugin-system.md §7) ────────────────

/**
 * Pin caps are a sanity rail, not a curation stance — the user arranges their
 * own bars, folding starts only past this count.
 */
export const HEADER_PIN_LIMIT = 5;
/** Max selection-menu actions promoted to the first row. */
export const SELECTION_PIN_LIMIT = 5;

export type PluginPlacement = {
  shelfHeader: ContributionKey[];
  readerHeader: ContributionKey[];
  selection: ContributionKey[];
};

const PLACEMENT_KEY = "read-aware-plugin-placement";

const EMPTY_PLACEMENT: PluginPlacement = { shelfHeader: [], readerHeader: [], selection: [] };

function readPlacement(): PluginPlacement {
  try {
    const raw = localKV.getItem(PLACEMENT_KEY);
    if (!raw) return EMPTY_PLACEMENT;
    const parsed = JSON.parse(raw) as Partial<PluginPlacement>;
    return {
      shelfHeader: Array.isArray(parsed.shelfHeader) ? parsed.shelfHeader : [],
      readerHeader: Array.isArray(parsed.readerHeader) ? parsed.readerHeader : [],
      selection: Array.isArray(parsed.selection) ? parsed.selection : [],
    };
  } catch {
    return EMPTY_PLACEMENT;
  }
}

const placementBaseAtom = atom<PluginPlacement>(readPlacement());

/** Pinned contribution keys per surface; persisted app-side, never plugin-side. */
export const pluginPlacementAtom = atom(
  (get) => get(placementBaseAtom),
  (_get, set, next: PluginPlacement) => {
    set(placementBaseAtom, next);
    localKV.setItem(PLACEMENT_KEY, JSON.stringify(next));
  },
);

// ─── Dialog surface requests ─────────────────────────────────────────────────

/**
 * A view a plugin action asked to open as a modal Dialog (the reader-side
 * container for selection-action results and palette commands). One at a time;
 * the host component consumes and clears it.
 */
export type PluginDialogRequest = {
  pluginId: string;
  pluginName: string;
  view: PluginView;
};

export const pluginDialogAtom = atom<PluginDialogRequest | null>(null);

export function openPluginDialog(request: PluginDialogRequest): void {
  store.set(pluginDialogAtom, request);
}
