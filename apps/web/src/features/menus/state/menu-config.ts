/**
 * User-arranged menu layout for the customizable surfaces: which items
 * (built-in AND plugin-contributed) are visible, in what order, and which sit
 * in the vertical-dots overflow menu. The Menus settings page edits this;
 * the surfaces render from it.
 *
 * Item ids: built-ins are `core:<name>`; plugin contributions are
 * `plugin:<contributionKey>`. Resolution is tolerant by design — stored ids
 * whose item no longer exists are skipped at render (but kept in config so a
 * temporarily disabled plugin keeps its slot), and items never seen before
 * slot in at their default position (built-ins) or the overflow (plugins).
 *
 * Destinations — the pages the app can land on: Library, Agent, Notes,
 * Reading stats and plugin pages — are offered by both the primary
 * navigation and the shelf header, and live in exactly ONE place: in the
 * primary navigation, or else in the shelf header (inline or in its "More"
 * menu). The primary navigation therefore has no hidden zone of its own:
 * resolved, its `overflow` is "the destinations the shelf header holds";
 * stored, it records the pages taken out of the navigation, so a page the
 * user never placed (a built-in added by an update) can still be told apart
 * and join the navigation the way its default says.
 *
 * Every surface reads through `resolveMenuLayouts` and every write goes
 * through `arrangeSurface` (or `moveMenuItem`, built on it), so the editor,
 * the live header and the settings tool cannot disagree on these rules.
 */
import { atom, getDefaultStore } from "jotai";
import { localKV, onLocalKVChange } from "../../../platform/local-store";

export type MenuSurface = "primaryNav" | "shelfHeader" | "readerHeader" | "readerToolbar" | "selection";

export type SurfaceLayout = {
  /** Ordered, rendered inline. */
  visible: string[];
  /** Ordered, rendered inside the vertical-dots overflow menu. */
  overflow: string[];
};

export type MenuConfig = Record<MenuSurface, SurfaceLayout>;

/** The built-in destinations, in their default order. */
export const CORE_DESTINATION_IDS = ["core:library", "core:agent", "core:annotations", "core:stats"] as const;

/** Built-in item ids per surface, in their default order. */
export const CORE_MENU_DEFAULTS: Record<MenuSurface, string[]> = {
  // The centered text switcher. Destinations left out of it (Reading stats,
  // plugin pages) live in the shelf header instead.
  primaryNav: ["core:library", "core:agent", "core:annotations"],
  shelfHeader: ["core:search", "core:import", "core:viewControl", "core:stats", "core:settings"],
  // Right cluster only — back/TOC/notes stay fixed on the left.
  readerHeader: ["core:bookmark", "core:find", "core:navigator", "core:appearance", "core:chat"],
  // The phone reader's bottom toolbar. Back and the overflow menu stay fixed
  // in the top bar, so every action here — contents and notes included — is
  // the user's to arrange; what doesn't fit the width joins the overflow.
  readerToolbar: ["core:toc", "core:notes", "core:find", "core:navigator", "core:appearance", "core:chat"],
  selection: ["core:copy", "core:highlight", "core:underline", "core:addNote", "core:askAI"],
};

/**
 * Known built-ins that start OUT of the visible zone. `resolveSurfaceLayout`
 * promotes unplaced core ids to visible, so these must be pre-placed in the
 * default layout rather than left for resolution to discover.
 */
export const CORE_OVERFLOW_DEFAULTS: Record<MenuSurface, string[]> = {
  // No hidden zone: a destination not in the navigation is in the shelf header.
  primaryNav: [],
  // Folder imports are occasional: a menu entry, not another header icon.
  // (Destinations the shelf header gains unplaced also arrive here.)
  shelfHeader: ["core:importFolder"],
  readerHeader: [],
  // A phone's bottom bar is full; bookmarking a page waits in "More".
  readerToolbar: ["core:bookmark"],
  selection: [],
};

/** Per-surface arrangement rules the Menus editor enforces. */
export const SURFACE_RULES: Record<MenuSurface, { minVisible: number; maxVisible: number | null }> = {
  // Never empty (it is the only way between Library and Agent) and capped so
  // the centered switcher cannot outgrow a narrow window.
  primaryNav: { minVisible: 1, maxVisible: 4 },
  shelfHeader: { minVisible: 0, maxVisible: null },
  readerHeader: { minVisible: 0, maxVisible: null },
  readerToolbar: { minVisible: 0, maxVisible: null },
  selection: { minVisible: 0, maxVisible: null },
};

export const MENU_CONFIG_KEY = "read-aware-menu-config";
const STORAGE_KEY = MENU_CONFIG_KEY;
/** The superseded plugin pin store — migrated into this config on first read. */
const LEGACY_PLACEMENT_KEY = "read-aware-plugin-placement";

export function pluginMenuId(contributionKey: string): string {
  return `plugin:${contributionKey}`;
}

function defaultLayout(surface: MenuSurface): SurfaceLayout {
  return {
    visible: [...CORE_MENU_DEFAULTS[surface]],
    overflow: [...CORE_OVERFLOW_DEFAULTS[surface]],
  };
}

function defaultConfig(): MenuConfig {
  return {
    primaryNav: defaultLayout("primaryNav"),
    shelfHeader: defaultLayout("shelfHeader"),
    readerHeader: defaultLayout("readerHeader"),
    readerToolbar: defaultLayout("readerToolbar"),
    selection: defaultLayout("selection"),
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
      primaryNav: sanitizeLayout(parsed.primaryNav, base.primaryNav),
      shelfHeader: sanitizeLayout(parsed.shelfHeader, base.shelfHeader),
      readerHeader: sanitizeLayout(parsed.readerHeader, base.readerHeader),
      readerToolbar: sanitizeLayout(parsed.readerToolbar, base.readerToolbar),
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

onLocalKVChange((key) => {
  if (key === MENU_CONFIG_KEY) getDefaultStore().set(menuConfigBaseAtom, readStored());
});

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
    [surface]: defaultLayout(surface),
  });
}

/**
 * Merge the stored layout with what actually exists right now:
 * - stored ids not in `known` are dropped from the result (config untouched);
 * - known ids missing from the config are appended — built-ins to `visible`
 *   (they were always visible before customization existed), plugin items to
 *   `overflow` (new capability arrives quietly). A built-in that starts out
 *   of sight (`defaultOverflowIds`, the surface's CORE_OVERFLOW_DEFAULTS)
 *   joins a saved layout in `overflow` too, as it does the default one.
 */
export function resolveSurfaceLayout(
  layout: SurfaceLayout,
  knownIds: string[],
  options?: { defaultVisibleIds?: readonly string[]; defaultOverflowIds?: readonly string[] },
): SurfaceLayout {
  const known = new Set(knownIds);
  const defaultVisible = new Set(options?.defaultVisibleIds ?? []);
  const defaultOverflow = new Set(options?.defaultOverflowIds ?? []);
  const placed = new Set([...layout.visible, ...layout.overflow]);
  const visible = layout.visible.filter((id) => known.has(id));
  const overflow = layout.overflow.filter((id) => known.has(id));
  for (const id of knownIds) {
    if (placed.has(id)) continue;
    if (defaultOverflow.has(id)) overflow.push(id);
    else if (id.startsWith("core:") || defaultVisible.has(id)) visible.push(id);
    else overflow.push(id);
  }
  return { visible, overflow };
}

/**
 * The primaryNav invariants, applied after resolution: never render an empty
 * switcher (corrupt storage falls back to the defaults) and never exceed the
 * cap the editor enforces.
 */
export function clampPrimaryNavVisible(visible: string[]): string[] {
  const rules = SURFACE_RULES.primaryNav;
  const safe = visible.length > 0 ? visible : CORE_MENU_DEFAULTS.primaryNav;
  return rules.maxVisible === null ? [...safe] : safe.slice(0, rules.maxVisible);
}

/**
 * What can be arranged right now — built by `menuCatalog` (menus/lib) from
 * the core registry and the registered plugin contributions.
 */
export type MenuCatalog = {
  /** Arrangeable ids per surface, in default order. The primary navigation
   *  and the shelf header both list every destination. */
  known: Record<MenuSurface, readonly string[]>;
  /** The destinations: offered by both shared surfaces, placed in one. */
  destinations: readonly string[];
  /** Non-core ids that start visible (the selection menu's lookup actions). */
  defaultVisible: Partial<Record<MenuSurface, readonly string[]>>;
};

/**
 * The layouts every surface renders: stored arrangement merged with what
 * exists (see `resolveSurfaceLayout`), plus the destination rule. A
 * destination in the primary navigation is absent from the shelf header;
 * every other destination is in the shelf header, joining its "More" menu
 * when the user never placed it there. A built-in destination placed
 * nowhere joins the navigation when it is one of its defaults (and fits).
 * Stored data that breaks the rule (layouts saved before it existed)
 * resolves with the navigation winning.
 */
export function resolveMenuLayouts(config: MenuConfig, catalog: MenuCatalog): MenuConfig {
  const destinations = new Set(catalog.destinations);
  const placedOutside = new Set([
    ...config.primaryNav.overflow,
    ...config.shelfHeader.visible,
    ...config.shelfHeader.overflow,
  ]);
  const storedNav = config.primaryNav.visible.filter((id) => destinations.has(id));
  const unplacedDefaults = CORE_MENU_DEFAULTS.primaryNav.filter(
    (id) => destinations.has(id) && !storedNav.includes(id) && !placedOutside.has(id),
  );
  const navVisible = clampPrimaryNavVisible([...storedNav, ...unplacedDefaults]);
  const inNav = new Set(navVisible);
  const resolveRest = (surface: Exclude<MenuSurface, "primaryNav" | "shelfHeader">): SurfaceLayout =>
    resolveSurfaceLayout(config[surface], [...catalog.known[surface]], {
      defaultOverflowIds: CORE_OVERFLOW_DEFAULTS[surface],
      defaultVisibleIds: catalog.defaultVisible[surface],
    });
  return {
    primaryNav: { visible: navVisible, overflow: catalog.destinations.filter((id) => !inNav.has(id)) },
    shelfHeader: resolveSurfaceLayout(
      config.shelfHeader,
      catalog.known.shelfHeader.filter((id) => !inNav.has(id)),
      { defaultOverflowIds: [...CORE_OVERFLOW_DEFAULTS.shelfHeader, ...catalog.destinations] },
    ),
    readerHeader: resolveRest("readerHeader"),
    readerToolbar: resolveRest("readerToolbar"),
    selection: resolveRest("selection"),
  };
}

/** Why an arrangement was refused: a surface would break its visible-count rule. */
export type MenuArrangementError = { surface: MenuSurface; rule: "minVisible" | "maxVisible"; limit: number };

export type MenuArrangement = { ok: true; config: MenuConfig } | { ok: false; error: MenuArrangementError };

function checkVisibleCount(surface: MenuSurface, visible: readonly string[]): MenuArrangementError | null {
  const rules = SURFACE_RULES[surface];
  if (visible.length < rules.minVisible) return { surface, rule: "minVisible", limit: rules.minVisible };
  if (rules.maxVisible !== null && visible.length > rules.maxVisible) {
    return { surface, rule: "maxVisible", limit: rules.maxVisible };
  }
  return null;
}

/**
 * The single write path: give `surface` exactly `layout`, keeping every
 * destination in one place — the latest placement wins. Placing a destination
 * in the primary navigation takes it out of the shelf header; placing one in
 * the shelf header takes it out of the navigation. For the primary
 * navigation only `layout.visible` counts: its `overflow` is derived, so a
 * destination dropped from the navigation lands in the shelf header's "More"
 * menu. Refused (config untouched) when either shared surface would break
 * its visible-count rule.
 */
export function arrangeSurface(
  config: MenuConfig,
  catalog: MenuCatalog,
  surface: MenuSurface,
  layout: SurfaceLayout,
): MenuArrangement {
  const destinations = new Set(catalog.destinations);
  if (surface === "primaryNav") {
    const visible = [...layout.visible];
    const error = checkVisibleCount("primaryNav", visible);
    if (error) return { ok: false, error };
    const inNav = new Set(visible);
    const keep = (id: string) => !inNav.has(id);
    // Every other page is now deliberately out of the navigation; recorded
    // (alongside ids of plugins absent right now) so none drifts back in.
    const outside = [...new Set([...config.primaryNav.overflow, ...catalog.destinations])].filter(keep);
    return {
      ok: true,
      config: {
        ...config,
        primaryNav: { visible, overflow: outside },
        shelfHeader: {
          visible: config.shelfHeader.visible.filter(keep),
          overflow: config.shelfHeader.overflow.filter(keep),
        },
      },
    };
  }

  const error = checkVisibleCount(surface, layout.visible);
  if (error) return { ok: false, error };
  if (surface !== "shelfHeader") return { ok: true, config: { ...config, [surface]: layout } };

  const adopted = [...layout.visible, ...layout.overflow].filter((id) => destinations.has(id));
  const navError = checkVisibleCount(
    "primaryNav",
    resolveMenuLayouts(config, catalog).primaryNav.visible.filter((id) => !adopted.includes(id)),
  );
  if (navError) return { ok: false, error: navError };
  // Only the adopted pages leave the stored navigation: the rest of it —
  // including a page whose plugin is disabled right now — keeps its slot.
  return {
    ok: true,
    config: {
      ...config,
      shelfHeader: layout,
      primaryNav: {
        visible: config.primaryNav.visible.filter((id) => !adopted.includes(id)),
        overflow: [...new Set([...config.primaryNav.overflow, ...adopted])],
      },
    },
  };
}

/** One dragged item: the surface it is shown on and its id. */
export type MenuItemRef = { surface: MenuSurface; id: string };

/** Where a dragged item is dropped: before `beforeId`, or at the zone's end. */
export type MenuDropTarget = { surface: MenuSurface; zone: keyof SurfaceLayout; beforeId: string | null };

/** Whether `item` may be dropped on `target`: within its own surface, or a
 *  destination crossing between the primary navigation and the shelf header.
 *  The primary navigation has no hidden zone to drop into. */
export function canMoveMenuItem(catalog: MenuCatalog, item: MenuItemRef, target: MenuDropTarget): boolean {
  if (target.surface === "primaryNav" && target.zone === "overflow") return false;
  if (item.surface === target.surface) return true;
  const shared = (surface: MenuSurface) => surface === "primaryNav" || surface === "shelfHeader";
  return shared(item.surface) && shared(target.surface) && catalog.destinations.includes(item.id);
}

/** A drag-and-drop move, expressed as an `arrangeSurface` of the target
 *  surface (which also takes a destination out of the surface it left).
 *  Null when the move is not allowed at all (`canMoveMenuItem`). */
export function moveMenuItem(
  config: MenuConfig,
  catalog: MenuCatalog,
  item: MenuItemRef,
  target: MenuDropTarget,
): MenuArrangement | null {
  if (!canMoveMenuItem(catalog, item, target)) return null;
  const current = resolveMenuLayouts(config, catalog)[target.surface];
  const without = (list: readonly string[]) => list.filter((id) => id !== item.id);
  const next: SurfaceLayout = { visible: without(current.visible), overflow: without(current.overflow) };
  const zone = next[target.zone];
  const index = target.beforeId ? zone.indexOf(target.beforeId) : -1;
  if (index >= 0) zone.splice(index, 0, item.id);
  else zone.push(item.id);
  return arrangeSurface(config, catalog, target.surface, next);
}
