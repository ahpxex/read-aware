/**
 * The menu surfaces as the agent's settings catalog sees them: per surface,
 * the known arrangeable items (core + plugin contributions, with labels) and
 * the RESOLVED layout — what the user actually sees, tolerant of stored ids
 * that no longer exist, exactly like the Customize editor renders it.
 */
import { contributionText } from "../../plugins/lib/plugin-i18n";
import type {
  RegisteredHeaderAction,
  RegisteredReaderMode,
  RegisteredSelectionAction,
} from "../../plugins/lib/plugin-types";
import { CORE_MENU_ITEMS } from "./menu-registry";
import {
  clampPrimaryNavVisible,
  pluginMenuId,
  resolveSurfaceLayout,
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

function pluginItemsForSurface(
  surface: MenuSurface,
  plugins: MenuPluginState,
): MenuSurfaceItem[] {
  const actions =
    surface === "selection"
      ? plugins.selectionActions
      : plugins.headerActions.filter((action) =>
          surface === "primaryNav"
            ? action.surface === "shelf" && action.presentation === "page"
            : surface === "shelfHeader"
              ? action.surface === "shelf"
              : action.surface === "reader",
        );
  return actions.map((action) => ({
    id: pluginMenuId(action.key),
    label: contributionText(action.title),
    source: "plugin" as const,
    pluginName: action.pluginName,
  }));
}

/** English labels for the agent-facing catalog, like the rest of it — the
 *  human-facing Customize editor keeps its localized labels separately. */
const CORE_ITEM_LABELS: Record<string, string> = {
  library: "Library",
  agent: "Agent",
  stats: "Reading stats",
  search: "Search",
  import: "Import book",
  viewControl: "Shelf view",
  settings: "Settings",
  navigator: "Text-unit navigator",
  appearance: "Appearance",
  chat: "Chat",
  copy: "Copy",
  highlight: "Highlight",
  underline: "Underline",
  addNote: "Add note",
  askAI: "Ask AI",
};

/** All arrangeable items for one surface, core first, in default order. */
export function knownSurfaceItems(
  surface: MenuSurface,
  plugins: MenuPluginState,
): MenuSurfaceItem[] {
  const core = CORE_MENU_ITEMS[surface]
    .filter(
      (meta) => meta.id !== "core:navigator" || plugins.textUnitReaderMode,
    )
    .map((meta) => ({
      id: meta.id,
      label: CORE_ITEM_LABELS[meta.labelKey] ?? meta.labelKey,
      source: "builtin" as const,
    }));
  return [...core, ...pluginItemsForSurface(surface, plugins)];
}

/** The layout as rendered: stale ids dropped, unplaced known ids slotted in. */
export function resolvedSurfaceLayout(
  surface: MenuSurface,
  config: MenuConfig,
  plugins: MenuPluginState,
): SurfaceLayout {
  const known = knownSurfaceItems(surface, plugins).map((item) => item.id);
  const layout = resolveSurfaceLayout(config[surface], known, {
    defaultVisibleIds:
      surface === "selection"
        ? plugins.selectionActions
            .filter((action) => action.role === "lookup")
            .map((action) => pluginMenuId(action.key))
        : [],
  });
  return surface === "primaryNav"
    ? { ...layout, visible: clampPrimaryNavVisible(layout.visible) }
    : layout;
}
