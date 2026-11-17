/**
 * Drag-to-arrange editor for one surface's menu layout, rendered as the real
 * thing: a bar of icon buttons (the surface as it looks live, dots trigger at
 * the end) with the overflow panel opened beneath it. Items drag directly
 * between bar and panel; hover tooltips name them. Everything drags; widget
 * items placed in the overflow still render inline live (renderableLayout).
 *
 * Destinations (pages) are shared by the primary navigation and the shelf
 * header and live in one of them, so they also drag between those two
 * editors. The primary navigation has no hidden zone: dragging a page out of
 * it means placing it in the shelf header. Every drop goes through
 * `moveMenuItem`, the rule the live header and the settings tool share.
 */
import { DotsThreeVertical } from "@phosphor-icons/react";
import { Fragment, type ReactNode } from "react";
import { atom, useAtom, useAtomValue } from "jotai";
import { Button, Caption, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useLocale, useTranslation } from "../../../i18n";
import {
  contributionText,
  headerActionsAtom,
  renderPluginIcon,
  resolvePluginText,
  selectionActionsAtom,
  textUnitReaderModeAtom,
} from "../../plugins";
import { useMenuCatalog } from "../hooks/useMenuLayouts";
import { CORE_MENU_ITEMS, coreDestination } from "../lib/menu-registry";
import {
  canMoveMenuItem,
  menuConfigAtom,
  moveMenuItem,
  pluginMenuId,
  resetSurfaceLayout,
  resolveMenuLayouts,
  type MenuItemRef,
  type MenuSurface,
  type SurfaceLayout,
} from "../state/menu-config";

type EditorItem = {
  id: string;
  label: string;
  caption?: string;
  icon: ReactNode;
};

/** The item being dragged, shared by every editor on the page so a
 *  destination can cross from the primary navigation to the shelf header. */
const menuDragAtom = atom<MenuItemRef | null>(null);

/** Label and icon for every item the surface can hold. Destinations carry the
 *  navigation's own name, the same one the bar and the shelf header show. */
function useEditorItems(surface: MenuSurface, ids: readonly string[]): Map<string, EditorItem> {
  const { t } = useTranslation("settings");
  const { t: tNav } = useTranslation("nav");
  const locale = useLocale();
  const headerActions = useAtomValue(headerActionsAtom);
  const selectionActions = useAtomValue(selectionActionsAtom);
  const textUnitReaderMode = useAtomValue(textUnitReaderModeAtom);
  const pluginActions = surface === "selection" ? selectionActions : headerActions;

  const describe = (id: string): EditorItem | null => {
    const destination = coreDestination(id);
    if (destination) {
      return {
        id,
        label: tNav(`header.${destination.labelKey}`),
        icon: <destination.Icon size={16} weight="regular" aria-hidden="true" />,
      };
    }
    const action = pluginActions.find((entry) => pluginMenuId(entry.key) === id);
    if (action) {
      return {
        id,
        label: contributionText(action.title),
        caption: action.pluginName,
        icon: renderPluginIcon(action.icon, 16),
      };
    }
    const meta = CORE_MENU_ITEMS[surface].find((item) => item.id === id);
    if (!meta) return null;
    if (meta.id === "core:navigator" && textUnitReaderMode) {
      return {
        id,
        label: resolvePluginText(textUnitReaderMode.copy.menuLabel, locale),
        icon: renderPluginIcon(textUnitReaderMode.icon, 16),
      };
    }
    return {
      id,
      label: String(t(`menus.items.${meta.labelKey}` as never)),
      icon: <meta.Icon size={16} weight="regular" aria-hidden="true" />,
    };
  };

  return new Map(
    ids
      .map(describe)
      .filter((item): item is EditorItem => item !== null)
      .map((item) => [item.id, item] as const),
  );
}

export function MenuSurfaceEditor({ surface }: { surface: MenuSurface }) {
  const { t } = useTranslation("settings");
  const [config, setConfig] = useAtom(menuConfigAtom);
  const catalog = useMenuCatalog();
  const [drag, setDrag] = useAtom(menuDragAtom);
  // primaryNav is a row of text destinations, not icon buttons — the bar
  // renders labels with slash separators (the live look) and has no dots.
  const labelBar = surface === "primaryNav";
  const layout: SurfaceLayout = resolveMenuLayouts(config, catalog)[surface];
  const itemById = useEditorItems(surface, catalog.known[surface]);

  const accepts = (zone: keyof SurfaceLayout) =>
    drag !== null && canMoveMenuItem(catalog, drag, { surface, zone, beforeId: null });

  /** Drop the dragged item into `zone`, before `beforeId` (or at the end).
   *  A move that would break a surface rule is a no-op. */
  function drop(zone: keyof SurfaceLayout, beforeId: string | null) {
    if (!drag || drag.id === beforeId) return;
    const arrangement = moveMenuItem(config, catalog, drag, { surface, zone, beforeId });
    if (arrangement?.ok) setConfig(arrangement.config);
  }

  /** Drop-target props: only a droppable drag claims the event, so the
   *  browser shows "no drop" over a surface the item cannot join. */
  const dropTarget = (zone: keyof SurfaceLayout, beforeId: string | null) => ({
    onDragOver: (event: React.DragEvent) => {
      if (accepts(zone)) event.preventDefault();
    },
    onDrop: (event: React.DragEvent) => {
      if (!accepts(zone)) return;
      event.preventDefault();
      event.stopPropagation();
      drop(zone, beforeId);
      setDrag(null);
    },
  });

  const dragProps = (id: string, zone: keyof SurfaceLayout) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      setDrag({ surface, id });
      // WebKit refuses to start a drag without payload data.
      event.dataTransfer?.setData("text/plain", id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => setDrag(null),
    ...dropTarget(zone, id),
  });
  const dragging = (id: string) => drag?.surface === surface && drag.id === id;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {/* The bar, as it renders live: icon buttons + the dots trigger. */}
        <div
          {...dropTarget("visible", null)}
          className={cn(
            "flex min-h-[2.5rem] min-w-0 flex-1 items-center rounded-lg border border-border bg-[var(--ra-main-surface-color)] px-1.5 py-1",
            labelBar ? "justify-center gap-1" : "gap-0.5",
          )}
        >
          {layout.visible.map((id, index) => {
            const item = itemById.get(id);
            if (!item) return null;
            if (labelBar) {
              return (
                <Fragment key={id}>
                  {index > 0 && (
                    <span aria-hidden="true" className="select-none font-sans text-sm text-fg-subtle/50">
                      /
                    </span>
                  )}
                  <span
                    {...dragProps(id, "visible")}
                    className={cn(
                      "cursor-grab select-none whitespace-nowrap rounded-md px-1.5 py-1 font-sans text-sm font-medium text-fg hover:bg-fg/5",
                      dragging(id) && "opacity-40",
                    )}
                  >
                    {item.label}
                  </span>
                </Fragment>
              );
            }
            return (
              <Tooltip key={id} content={item.caption ? `${item.label} · ${item.caption}` : item.label} side="top">
                <span
                  {...dragProps(id, "visible")}
                  className={cn(
                    "flex h-8 w-8 shrink-0 cursor-grab select-none items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg",
                    dragging(id) && "opacity-40",
                  )}
                >
                  {item.icon}
                </span>
              </Tooltip>
            );
          })}
          {!labelBar && (
            <span
              aria-hidden="true"
              className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center text-fg-subtle"
            >
              <DotsThreeVertical size={18} weight="bold" />
            </span>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={() => resetSurfaceLayout(surface)}>
          {t("menus.reset")}
        </Button>
      </div>

      {labelBar ? (
        <Caption className="text-fg-subtle">{t("menus.primaryNavHint")}</Caption>
      ) : (
        // The overflow menu, opened beneath the dots — drop here to tuck away.
        <div
          {...dropTarget("overflow", null)}
          className={cn(
            "ml-auto mr-12 w-56 rounded-lg border bg-[var(--ra-main-surface-color)] p-1",
            layout.overflow.length === 0
              ? "border-dashed border-border"
              : "border-border shadow-[0_4px_16px_-6px_rgba(28,25,23,0.15)]",
          )}
        >
          {layout.overflow.map((id) => {
            const item = itemById.get(id);
            if (!item) return null;
            return (
              <div
                key={id}
                {...dragProps(id, "overflow")}
                className={cn(
                  "flex cursor-grab select-none items-center gap-2 rounded-md px-2 py-1.5 hover:bg-fg/5",
                  dragging(id) && "opacity-40",
                )}
              >
                <span className="text-fg-muted">{item.icon}</span>
                <span className="min-w-0 flex-1 truncate font-sans text-sm text-fg">
                  {item.label}
                  {item.caption && <Caption className="ml-2 inline text-fg-subtle">{item.caption}</Caption>}
                </span>
              </div>
            );
          })}
          {layout.overflow.length === 0 && (
            <div className="px-2 py-1.5 text-center font-sans text-xs text-fg-subtle">—</div>
          )}
        </div>
      )}
    </div>
  );
}
