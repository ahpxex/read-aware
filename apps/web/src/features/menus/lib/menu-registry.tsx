/**
 * Metadata for the built-in (core:*) menu items — icon + label for the Menus
 * settings editor and the overflow menus. The surfaces keep owning the real
 * rendering (tooltips, active states, popovers); this registry is how the
 * editor and overflow name them.
 *
 * Labels live under settings:menus.items.<name> so the editor is
 * self-contained instead of hunting keys across namespaces.
 */
import {
  BookOpen,
  Cards,
  ChartLineUp,
  ChatCircle,
  ChatCircleDots,
  Copy,
  GearSix,
  Highlighter,
  MagnifyingGlass,
  NotePencil,
  Plus,
  Rows,
  SquaresFour,
  TextAa,
  TextUnderline,
  type Icon,
} from "@phosphor-icons/react";
import type { MenuSurface } from "../state/menu-config";

export type CoreMenuItemMeta = {
  id: string;
  /** settings:menus.items.<labelKey> */
  labelKey: string;
  Icon: Icon;
};

export const CORE_MENU_ITEMS: Record<MenuSurface, CoreMenuItemMeta[]> = {
  shelfHeader: [
    { id: "core:search", labelKey: "search", Icon: MagnifyingGlass },
    { id: "core:import", labelKey: "import", Icon: Plus },
    { id: "core:viewControl", labelKey: "viewControl", Icon: SquaresFour },
    { id: "core:context", labelKey: "context", Icon: Cards },
    { id: "core:stats", labelKey: "stats", Icon: ChartLineUp },
    { id: "core:settings", labelKey: "settings", Icon: GearSix },
  ],
  readerHeader: [
    { id: "core:navigator", labelKey: "navigator", Icon: Rows },
    { id: "core:appearance", labelKey: "appearance", Icon: TextAa },
    { id: "core:chat", labelKey: "chat", Icon: ChatCircle },
  ],
  selection: [
    { id: "core:copy", labelKey: "copy", Icon: Copy },
    { id: "core:highlight", labelKey: "highlight", Icon: Highlighter },
    { id: "core:underline", labelKey: "underline", Icon: TextUnderline },
    { id: "core:addNote", labelKey: "addNote", Icon: NotePencil },
    { id: "core:lookUp", labelKey: "lookUp", Icon: BookOpen },
    { id: "core:askAI", labelKey: "askAI", Icon: ChatCircleDots },
  ],
};

export function coreMenuMeta(surface: MenuSurface, id: string): CoreMenuItemMeta | undefined {
  return CORE_MENU_ITEMS[surface].find((item) => item.id === id);
}
