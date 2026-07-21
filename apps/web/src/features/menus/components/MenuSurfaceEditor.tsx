/**
 * Drag-to-arrange editor for one surface's menu layout: two zones (shown /
 * overflow), native HTML5 drag between and within them. Core and plugin items
 * are peers; widget items (locked) can be reordered but not overflowed.
 */
import { DotsSixVertical } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { useAtom, useAtomValue } from "jotai";
import { Button, Caption } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { renderPluginIcon } from "../../plugins/lib/plugin-icons";
import { headerActionsAtom, selectionActionsAtom } from "../../plugins/state/plugin-store";
import { CORE_MENU_ITEMS, LOCKED_VISIBLE } from "../lib/menu-registry";
import {
  CORE_MENU_DEFAULTS,
  menuConfigAtom,
  pluginMenuId,
  resetSurfaceLayout,
  resolveSurfaceLayout,
  type MenuSurface,
} from "../state/menu-config";

type EditorItem = {
  id: string;
  label: string;
  caption?: string;
  icon: ReactNode;
  locked: boolean;
};

type Zone = "visible" | "overflow";

export function MenuSurfaceEditor({ surface }: { surface: MenuSurface }) {
  const { t } = useTranslation("settings");
  const [config, setConfig] = useAtom(menuConfigAtom);
  const headerActions = useAtomValue(headerActionsAtom);
  const selectionActions = useAtomValue(selectionActionsAtom);
  const [dragId, setDragId] = useState<string | null>(null);

  const pluginItems: EditorItem[] = (
    surface === "selection"
      ? selectionActions.map((action) => ({
          id: pluginMenuId(action.key),
          label: action.title,
          caption: action.pluginName,
          icon: renderPluginIcon(action.icon, 15),
          locked: false,
        }))
      : headerActions
          .filter((action) =>
            surface === "shelfHeader" ? action.surface === "shelf" : action.surface === "reader",
          )
          .map((action) => ({
            id: pluginMenuId(action.key),
            label: action.title,
            caption: action.pluginName,
            icon: renderPluginIcon(action.icon, 15),
            locked: false,
          }))
  );
  const coreItems: EditorItem[] = CORE_MENU_ITEMS[surface].map((meta) => ({
    id: meta.id,
    label: String(t(`menus.items.${meta.labelKey}` as never)),
    icon: <meta.Icon size={15} weight="regular" aria-hidden="true" />,
    locked: LOCKED_VISIBLE.has(meta.id),
  }));
  const itemById = new Map([...coreItems, ...pluginItems].map((item) => [item.id, item]));

  const layout = resolveSurfaceLayout(config[surface], [
    ...CORE_MENU_DEFAULTS[surface],
    ...pluginItems.map((item) => item.id),
  ]);

  function commit(visible: string[], overflow: string[]) {
    setConfig({ ...config, [surface]: { visible, overflow } });
  }

  /** Drop `dragId` into `zone`, before `beforeId` (or at the end). */
  function drop(zone: Zone, beforeId: string | null) {
    if (!dragId || dragId === beforeId) return;
    const item = itemById.get(dragId);
    if (!item) return;
    if (zone === "overflow" && item.locked) return;
    const without = (list: string[]) => list.filter((id) => id !== dragId);
    const next = { visible: without(layout.visible), overflow: without(layout.overflow) };
    const target = next[zone];
    const index = beforeId ? target.indexOf(beforeId) : -1;
    if (index >= 0) target.splice(index, 0, dragId);
    else target.push(dragId);
    commit(next.visible, next.overflow);
  }

  function renderRow(id: string, zone: Zone) {
    const item = itemById.get(id);
    if (!item) return null;
    return (
      <div
        key={id}
        draggable
        onDragStart={(event) => {
          setDragId(id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => setDragId(null)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          drop(zone, id);
          setDragId(null);
        }}
        className={cn(
          "flex cursor-grab items-center gap-2 rounded-md border border-border bg-[var(--ra-main-surface-color)] px-2 py-1.5",
          dragId === id && "opacity-40",
        )}
      >
        <DotsSixVertical size={14} weight="bold" className="shrink-0 text-fg-subtle" aria-hidden="true" />
        <span className="text-fg-muted">{item.icon}</span>
        <span className="min-w-0 flex-1 truncate font-sans text-sm text-fg">
          {item.label}
          {item.caption && (
            <Caption className="ml-2 inline text-fg-subtle">{item.caption}</Caption>
          )}
        </span>
        {item.locked && <Caption className="shrink-0 text-fg-subtle">{t("menus.shown")}</Caption>}
      </div>
    );
  }

  function renderZone(zone: Zone, ids: string[], title: string) {
    return (
      <div
        className="min-w-0 flex-1"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          drop(zone, null);
          setDragId(null);
        }}
      >
        <Caption className="mb-1.5 block text-fg-subtle">{title}</Caption>
        <div className="flex min-h-[3rem] flex-col gap-1 rounded-md border border-dashed border-border p-1.5">
          {ids.map((id) => renderRow(id, zone))}
          {ids.length === 0 && (
            <Caption className="px-1 py-2 text-fg-subtle">—</Caption>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
        {renderZone("visible", layout.visible, t("menus.shown"))}
        {renderZone("overflow", layout.overflow, t("menus.overflow"))}
      </div>
      <div className="flex items-center justify-between gap-4">
        <Caption className="text-fg-subtle">{t("menus.dragHint")}</Caption>
        <Button size="sm" variant="ghost" onClick={() => resetSurfaceLayout(surface)}>
          {t("menus.reset")}
        </Button>
      </div>
    </div>
  );
}
