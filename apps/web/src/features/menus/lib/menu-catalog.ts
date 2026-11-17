/**
 * The menu catalog: every item each customizable surface can hold right now
 * (core registry + registered plugin contributions), and the layouts as
 * rendered. The Customize editor, the app header and the agent's settings
 * catalog all read through here, so they agree on what exists and where it
 * is — including the destination rule in `resolveMenuLayouts`.
 */
// Leaf modules, not the plugins index: the settings domain imports this
// catalog, and the index would pull the plugin runtime into its graph.
import { contributionText } from "../../plugins/lib/plugin-i18n";
import type {
  RegisteredHeaderAction,
  RegisteredReaderMode,
  RegisteredSelectionAction,
} from "../../plugins/lib/plugin-types";
import { CORE_DESTINATIONS, CORE_MENU_ITEMS } from "./menu-registry";
import {
  CORE_DESTINATION_IDS,
  pluginMenuId,
  resolveMenuLayouts,
  type MenuCatalog,
  type MenuConfig,
  type MenuSurface,
  type SurfaceLayout,
} from "../state/menu-config";

export type MenuSurfaceItem = {
  id: string;
  label: string;
  source: "builtin" | "plugin";
  pluginName?: string;
};

export type MenuPluginState = {
  headerActions: RegisteredHeaderAction[];
  selectionActions: RegisteredSelectionAction[];
  textUnitReaderMode: RegisteredReaderMode | null;
};

/** A shelf plugin action that opens a full page — a destination. */
export function isPluginPage(action: RegisteredHeaderAction): boolean {
  return action.surface === "shelf" && action.presentation === "page";
}

/** The plugin contributions a surface offers. Plugin pages count as
 *  destinations, so the primary navigation offers them too. */
function pluginActionsForSurface(
  surface: MenuSurface,
  plugins: MenuPluginState,
): Array<RegisteredHeaderAction | RegisteredSelectionAction> {
  switch (surface) {
    case "primaryNav":
      return plugins.headerActions.filter(isPluginPage);
    case "shelfHeader":
      return plugins.headerActions.filter((action) => action.surface === "shelf");
    case "readerHeader":
    case "readerToolbar":
      return plugins.headerActions.filter((action) => action.surface === "reader");
    case "selection":
      return plugins.selectionActions;
  }
}

function coreActionIds(surface: MenuSurface, plugins: MenuPluginState): string[] {
  return CORE_MENU_ITEMS[surface]
    .filter((meta) => meta.id !== "core:navigator" || plugins.textUnitReaderMode)
    .map((meta) => meta.id);
}

export function menuCatalog(plugins: MenuPluginState): MenuCatalog {
  const pluginIds = (surface: MenuSurface) =>
    pluginActionsForSurface(surface, plugins).map((action) => pluginMenuId(action.key));
  const destinations = [...CORE_DESTINATION_IDS, ...pluginIds("primaryNav")];
  const known = (surface: MenuSurface) => [...coreActionIds(surface, plugins), ...pluginIds(surface)];
  return {
    known: {
      primaryNav: destinations,
      // Shelf plugin actions already include the plugin pages.
      shelfHeader: [...coreActionIds("shelfHeader", plugins), ...CORE_DESTINATION_IDS, ...pluginIds("shelfHeader")],
      readerHeader: known("readerHeader"),
      readerToolbar: known("readerToolbar"),
      selection: known("selection"),
    },
    destinations,
    defaultVisible: {
      selection: plugins.selectionActions
        .filter((action) => action.role === "lookup")
        .map((action) => pluginMenuId(action.key)),
    },
  };
}

/** English labels for the agent-facing catalog, like the rest of it — the
 *  human-facing Customize editor keeps its localized labels separately. */
const CORE_ITEM_LABELS: Record<string, string> = {
  library: "Library",
  agent: "Agent",
  annotations: "Notes",
  stats: "Reading stats",
  search: "Search",
  import: "Import book",
  importFolder: "Import folder",
  viewControl: "Shelf view",
  settings: "Settings",
  toc: "Table of contents",
  notes: "Notes",
  navigator: "Text-unit navigator",
  appearance: "Appearance",
  chat: "Chat",
  addBookmark: "Add bookmark",
  findInBook: "Find in book",
  copy: "Copy",
  highlight: "Highlight",
  underline: "Underline",
  addNote: "Add note",
  askAI: "Ask AI",
};

/** All arrangeable items for one surface, in catalog order, with English labels. */
export function knownSurfaceItems(surface: MenuSurface, plugins: MenuPluginState): MenuSurfaceItem[] {
  const coreLabelKeys = new Map<string, string>([
    ...CORE_DESTINATIONS.map((meta) => [meta.id, meta.labelKey] as const),
    ...CORE_MENU_ITEMS[surface].map((meta) => [meta.id, meta.labelKey] as const),
  ]);
  const pluginActions = new Map(
    pluginActionsForSurface(surface, plugins).map((action) => [pluginMenuId(action.key), action] as const),
  );
  return menuCatalog(plugins).known[surface].map((id): MenuSurfaceItem => {
    const action = pluginActions.get(id);
    if (action) {
      return { id, label: contributionText(action.title), source: "plugin", pluginName: action.pluginName };
    }
    const labelKey = coreLabelKeys.get(id) ?? id;
    return { id, label: CORE_ITEM_LABELS[labelKey] ?? labelKey, source: "builtin" };
  });
}

/** One surface's layout as rendered (see `resolveMenuLayouts`). */
export function resolvedSurfaceLayout(
  surface: MenuSurface,
  config: MenuConfig,
  plugins: MenuPluginState,
): SurfaceLayout {
  return resolveMenuLayouts(config, menuCatalog(plugins))[surface];
}
