/**
 * Drag-to-arrange editor for one surface's menu layout, rendered as the real
 * thing: a bar of icon buttons (the surface as it looks live, dots trigger at
 * the end) with the overflow panel opened beneath it. Items drag directly
 * between bar and panel; hover tooltips name them. Everything drags; widget
 * items placed in the overflow still render inline live (renderableLayout).
 */
import { DotsThreeVertical } from "@phosphor-icons/react";
import { contributionText } from "../../plugins/lib/plugin-i18n";
import { Fragment, useState, type ReactNode } from "react";
import { useAtom, useAtomValue } from "jotai";
import { Button, Caption, Tooltip } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useLocale, useTranslation } from "../../../i18n";
import { resolvePluginText } from "../../plugins/lib/plugin-i18n";
import { renderPluginIcon } from "../../plugins/lib/plugin-icons";
import {
  headerActionsAtom,
  selectionActionsAtom,
  textUnitReaderModeAtom,
} from "../../plugins/state/plugin-store";
import { CORE_MENU_ITEMS } from "../lib/menu-registry";
import {
  menuConfigAtom,
  pluginMenuId,
  resetSurfaceLayout,
  resolveSurfaceLayout,
  SURFACE_RULES,
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
  const locale = useLocale();
  const [config, setConfig] = useAtom(menuConfigAtom);
  const headerActions = useAtomValue(headerActionsAtom);
  const selectionActions = useAtomValue(selectionActionsAtom);
  const textUnitReaderMode = useAtomValue(textUnitReaderModeAtom);
  const [dragId, setDragId] = useState<string | null>(null);
  // primaryNav is a row of text destinations, not icon buttons — the bar
  // renders labels with slash separators (the live look) and has no dots.
  const labelBar = surface === "primaryNav";
  const rules = SURFACE_RULES[surface];

  const pluginItems: EditorItem[] = (
    surface === "selection"
      ? selectionActions
      : headerActions.filter((action) =>
          // Only page contributions qualify as primary destinations.
          surface === "primaryNav"
            ? action.surface === "shelf" && action.presentation === "page"
            : surface === "shelfHeader"
              ? action.surface === "shelf"
              : action.surface === "reader",
        )
  ).map((action) => ({
    id: pluginMenuId(action.key),
    label: contributionText(action.title),
    caption: action.pluginName,
    icon: renderPluginIcon(action.icon, 16),
    locked: false,
  }));
  const coreItems: EditorItem[] = CORE_MENU_ITEMS[surface]
    .filter((meta) =>
      meta.id !== "core:navigator" || textUnitReaderMode !== null,
    )
    .map((meta) => ({
      id: meta.id,
      label:
        meta.id === "core:navigator" && textUnitReaderMode
          ? resolvePluginText(textUnitReaderMode.copy.menuLabel, locale)
          : String(t(`menus.items.${meta.labelKey}` as never)),
      icon:
        meta.id === "core:navigator" && textUnitReaderMode
          ? renderPluginIcon(textUnitReaderMode.icon, 16)
          : <meta.Icon size={16} weight="regular" aria-hidden="true" />,
      locked: false,
    }));
  const itemById = new Map([...coreItems, ...pluginItems].map((item) => [item.id, item]));

  const layout = resolveSurfaceLayout(
    config[surface],
    [
      ...coreItems.map((item) => item.id),
      ...pluginItems.map((item) => item.id),
    ],
    {
      defaultVisibleIds:
        surface === "selection"
          ? selectionActions
              .filter((action) => action.role === "lookup")
              .map((action) => pluginMenuId(action.key))
          : [],
    },
  );

  /** Drop `dragId` into `zone`, before `beforeId` (or at the end). */
  function drop(zone: Zone, beforeId: string | null) {
    if (!dragId || dragId === beforeId) return;
    if (!itemById.has(dragId)) return;
    const without = (list: string[]) => list.filter((id) => id !== dragId);
    const next = { visible: without(layout.visible), overflow: without(layout.overflow) };
    const target = next[zone];
    const index = beforeId ? target.indexOf(beforeId) : -1;
    if (index >= 0) target.splice(index, 0, dragId);
    else target.push(dragId);
    // Surface rules: the drop is a no-op rather than a broken arrangement.
    if (next.visible.length < rules.minVisible) return;
    if (rules.maxVisible !== null && next.visible.length > rules.maxVisible)
      return;
    setConfig({ ...config, [surface]: next });
  }

  const dragProps = (id: string, zone: Zone) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      setDragId(id);
      // WebKit refuses to start a drag without payload data.
      event.dataTransfer?.setData("text/plain", id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => setDragId(null),
    onDragOver: (event: React.DragEvent) => event.preventDefault(),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      drop(zone, id);
      setDragId(null);
    },
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {/* The bar, as it renders live: icon buttons + the dots trigger. */}
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            drop("visible", null);
            setDragId(null);
          }}
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
                    <span
                      aria-hidden="true"
                      className="select-none font-sans text-sm text-fg-subtle/50"
                    >
                      /
                    </span>
                  )}
                  <span
                    {...dragProps(id, "visible")}
                    className={cn(
                      "cursor-grab select-none whitespace-nowrap rounded-md px-1.5 py-1 font-sans text-sm font-medium text-fg hover:bg-fg/5",
                      dragId === id && "opacity-40",
                    )}
                  >
                    {item.label}
                  </span>
                </Fragment>
              );
            }
            return (
              <Tooltip
                key={id}
                content={item.caption ? `${item.label} · ${item.caption}` : item.label}
                side="top"
              >
                <span
                  {...dragProps(id, "visible")}
                  className={cn(
                    "flex h-8 w-8 shrink-0 cursor-grab select-none items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg",
                    dragId === id && "opacity-40",
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

      {/* The overflow menu, opened beneath the dots — drop here to tuck away. */}
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          drop("overflow", null);
          setDragId(null);
        }}
        className={cn(
          "ml-auto mr-12 w-56 rounded-lg border bg-[var(--ra-main-surface-color)] p-1",
          // primaryNav has no live overflow menu — its second zone is plain
          // "not shown" storage, so it never gets the dropdown shadow.
          labelBar || layout.overflow.length === 0
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
                dragId === id && "opacity-40",
              )}
            >
              <span className="text-fg-muted">{item.icon}</span>
              <span className="min-w-0 flex-1 truncate font-sans text-sm text-fg">
                {item.label}
                {item.caption && (
                  <Caption className="ml-2 inline text-fg-subtle">{item.caption}</Caption>
                )}
              </span>
            </div>
          );
        })}
        {layout.overflow.length === 0 && (
          <div className="px-2 py-1.5 text-center font-sans text-xs text-fg-subtle">—</div>
        )}
      </div>
    </div>
  );
}
