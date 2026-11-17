/**
 * Metadata for the built-in (core:*) menu items — icon + label for the Menus
 * settings editor and the overflow menus. The surfaces keep owning the real
 * rendering (tooltips, active states, popovers); this registry is how the
 * editor and overflow name them.
 *
 * Action labels live under settings:menus.items.<name>. Destinations are
 * named once, by the navigation (nav:header.<name>), wherever they appear —
 * the bar, the shelf header, its "More" menu and the editor.
 */
import {
  BookmarkSimple,
  Books,
  ChartLineUp,
  ChatCircle,
  ChatCircleDots,
  Copy,
  FolderPlus,
  GearSix,
  Highlighter,
  ListBullets,
  MagnifyingGlass,
  Notebook,
  NotePencil,
  Plus,
  Rows,
  SlidersHorizontal,
  TextAa,
  TextUnderline,
  type Icon,
} from "@phosphor-icons/react";
import type { TopNav } from "../../../state/ui";
import { CORE_DESTINATION_IDS, type MenuSurface } from "../state/menu-config";

export type CoreMenuItemMeta = {
  id: string;
  /** settings:menus.items.<labelKey> */
  labelKey: string;
  Icon: Icon;
};

export type CoreDestinationMeta = {
  id: (typeof CORE_DESTINATION_IDS)[number];
  topNav: TopNav;
  /** nav:header.<labelKey> */
  labelKey: "library" | "agent" | "annotations" | "stats";
  Icon: Icon;
};

/** The built-in destinations, in CORE_DESTINATION_IDS order. Each is placed
 *  in the primary navigation or the shelf header, never both. */
export const CORE_DESTINATIONS: CoreDestinationMeta[] = [
  { id: "core:library", topNav: "shelf", labelKey: "library", Icon: Books },
  { id: "core:agent", topNav: "agent", labelKey: "agent", Icon: ChatCircleDots },
  { id: "core:annotations", topNav: "annotations", labelKey: "annotations", Icon: Notebook },
  { id: "core:stats", topNav: "stats", labelKey: "stats", Icon: ChartLineUp },
];

export function coreDestination(id: string): CoreDestinationMeta | undefined {
  return CORE_DESTINATIONS.find((destination) => destination.id === id);
}

/** The built-in ACTIONS per surface. Destinations are listed once, above;
 *  the catalog offers them to the primary navigation and the shelf header. */
export const CORE_MENU_ITEMS: Record<MenuSurface, CoreMenuItemMeta[]> = {
  primaryNav: [],
  shelfHeader: [
    { id: "core:search", labelKey: "search", Icon: MagnifyingGlass },
    { id: "core:import", labelKey: "import", Icon: Plus },
    { id: "core:importFolder", labelKey: "importFolder", Icon: FolderPlus },
    {
      id: "core:viewControl",
      labelKey: "viewControl",
      Icon: SlidersHorizontal,
    },
    { id: "core:settings", labelKey: "settings", Icon: GearSix },
  ],
  readerHeader: [
    { id: "core:bookmark", labelKey: "addBookmark", Icon: BookmarkSimple },
    { id: "core:find", labelKey: "findInBook", Icon: MagnifyingGlass },
    { id: "core:navigator", labelKey: "navigator", Icon: Rows },
    { id: "core:appearance", labelKey: "appearance", Icon: TextAa },
    { id: "core:chat", labelKey: "chat", Icon: ChatCircle },
  ],
  readerToolbar: [
    { id: "core:toc", labelKey: "toc", Icon: ListBullets },
    { id: "core:notes", labelKey: "notes", Icon: Notebook },
    { id: "core:find", labelKey: "findInBook", Icon: MagnifyingGlass },
    { id: "core:navigator", labelKey: "navigator", Icon: Rows },
    { id: "core:appearance", labelKey: "appearance", Icon: TextAa },
    { id: "core:chat", labelKey: "chat", Icon: ChatCircle },
    { id: "core:bookmark", labelKey: "addBookmark", Icon: BookmarkSimple },
  ],
  selection: [
    { id: "core:copy", labelKey: "copy", Icon: Copy },
    { id: "core:highlight", labelKey: "highlight", Icon: Highlighter },
    { id: "core:underline", labelKey: "underline", Icon: TextUnderline },
    { id: "core:addNote", labelKey: "addNote", Icon: NotePencil },
    { id: "core:askAI", labelKey: "askAI", Icon: ChatCircleDots },
  ],
};

export function coreMenuMeta(surface: MenuSurface, id: string): CoreMenuItemMeta | undefined {
  return CORE_MENU_ITEMS[surface].find((item) => item.id === id);
}
