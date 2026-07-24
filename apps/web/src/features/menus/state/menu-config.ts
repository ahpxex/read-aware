/**
 * User-arranged menu layout for the three customizable surfaces: which items
 * (built-in AND plugin-contributed) are visible, in what order, and which sit
 * in the vertical-dots overflow menu. The Menus settings page edits this;
 * the surfaces render from it.
 *
 * Item ids: built-ins are `core:<name>`; plugin contributions are
 * `plugin:<contributionKey>`. Resolution is tolerant by design — stored ids
 * whose item no longer exists are skipped at render (but kept in config so a
 * temporarily disabled plugin keeps its slot), and items never seen before
 * slot in at their default position (built-ins) or the overflow (plugins).
 */
import { atom, getDefaultStore } from "jotai";
import { localKV } from "../../../platform/local-store";

export type MenuSurface = "shelfHeader" | "readerHeader" | "selection";

export type SurfaceLayout = {
  /** Ordered, rendered inline. */
  visible: string[];
  /** Ordered, rendered inside the vertical-dots overflow menu. */
  overflow: string[];
};

export type MenuConfig = Record<MenuSurface, SurfaceLayout>;

/** Built-in item ids per surface, in their default order. */
export const CORE_MENU_DEFAULTS: Record<MenuSurface, string[]> = {
  shelfHeader: [
    "core:search",
    "core:import",
    "core:viewControl",
    "core:context",
    "core:stats",
    "core:settings",
  ],
  // Right cluster only — back/TOC/notes stay fixed on the left.
  readerHeader: ["core:navigator", "core:appearance", "core:chat"],
  selection: [
    "core:copy",
    "core:highlight",
    "core:underline",
    "core:addNote",
    "core:askAI",
  ],
};

const STORAGE_KEY = "read-aware-menu-config";
/** The superseded plugin pin store — migrated into this config on first read. */
const LEGACY_PLACEMENT_KEY = "read-aware-plugin-placement";

export function pluginMenuId(contributionKey: string): string {
  return `plugin:${contributionKey}`;
}

function defaultConfig(): MenuConfig {
  return {
    shelfHeader: { visible: [...CORE_MENU_DEFAULTS.shelfHeader], overflow: [] },
    readerHeader: { visible: [...CORE_MENU_DEFAULTS.readerHeader], overflow: [] },
    selection: { visible: [...CORE_MENU_DEFAULTS.selection], overflow: [] },
  };
}

function sanitizeLayout(raw: unknown, fallback: SurfaceLayout): SurfaceLayout {
  if (typeof raw !== "object" || raw === null) return fallback;
  const record = raw as Partial<SurfaceLayout>;
  const clean = (list: unknown): string[] | null =>
    Array.isArray(list) ? [...new Set(list.filter((id): id is string => typeof id === "string"))] : null;
  return {
    visible: clean(record.visible) ?? fallback.visible,
    overflow: clean(record.overflow) ?? fallback.overflow,
  };
}

function readStored(): MenuConfig {
  const base = defaultConfig();
  try {
    const raw = localKV.getItem(STORAGE_KEY);
    if (!raw) return migrateLegacyPlacement(base);
    const parsed = JSON.parse(raw) as Partial<Record<MenuSurface, unknown>>;
    return {
      shelfHeader: sanitizeLayout(parsed.shelfHeader, base.shelfHeader),
      readerHeader: sanitizeLayout(parsed.readerHeader, base.readerHeader),
      selection: sanitizeLayout(parsed.selection, base.selection),
    };
  } catch {
    return base;
  }
}

/** One-time adoption of the old pin lists: pinned keys become visible items. */
function migrateLegacyPlacement(base: MenuConfig): MenuConfig {
  try {
    const raw = localKV.getItem(LEGACY_PLACEMENT_KEY);
    if (!raw) return base;
    const legacy = JSON.parse(raw) as Partial<Record<MenuSurface, string[]>>;
    for (const surface of ["shelfHeader", "readerHeader", "selection"] as const) {
      for (const key of legacy[surface] ?? []) {
        const id = pluginMenuId(key);
        if (!base[surface].visible.includes(id)) base[surface].visible.push(id);
      }
    }
  } catch {
    // Legacy data is best-effort only.
  }
  return base;
}

const menuConfigBaseAtom = atom<MenuConfig>(readStored());

export const menuConfigAtom = atom(
  (get) => get(menuConfigBaseAtom),
  (_get, set, next: MenuConfig) => {
    set(menuConfigBaseAtom, next);
    localKV.setItem(STORAGE_KEY, JSON.stringify(next));
  },
);

export function resetSurfaceLayout(surface: MenuSurface): void {
  const store = getDefaultStore();
  const current = store.get(menuConfigAtom);
  store.set(menuConfigAtom, {
    ...current,
    [surface]: { visible: [...CORE_MENU_DEFAULTS[surface]], overflow: [] },
  });
}

/**
 * Merge the stored layout with what actually exists right now:
 * - stored ids not in `known` are dropped from the result (config untouched);
 * - known ids missing from the config are appended — built-ins to `visible`
 *   (they were always visible before customization existed), plugin items to
 *   `overflow` (new capability arrives quietly).
 */
export function resolveSurfaceLayout(
  layout: SurfaceLayout,
  knownIds: string[],
  options?: { defaultVisibleIds?: readonly string[] },
): SurfaceLayout {
  const known = new Set(knownIds);
  const defaultVisible = new Set(options?.defaultVisibleIds ?? []);
  const placed = new Set([...layout.visible, ...layout.overflow]);
  const visible = layout.visible.filter((id) => known.has(id));
  const overflow = layout.overflow.filter((id) => known.has(id));
  for (const id of knownIds) {
    if (placed.has(id)) continue;
    if (id.startsWith("core:") || defaultVisible.has(id)) visible.push(id);
    else overflow.push(id);
  }
  return { visible, overflow };
}
