/**
 * Drag-to-arrange editor for the reader header/footer strips: a miniature
 * page — header band, faint text lines, footer band — whose six positions
 * accept chips dragged from any other position or from the "Not shown" tray.
 * Pointer-event drag works on touch where HTML5 DnD does not; each chip also
 * carries a hide/show button as the tap and keyboard path.
 */
import { useAtom } from "jotai";
import { useRef } from "react";
import { useTranslation } from "../../../i18n";
import { Button, IconButton, Toggle } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { BatteryHigh, Book, BookOpenText, Clock, EyeSlash, Files, Percent, Plus } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import {
  defaultHeaderFooterSettings,
  type HeaderFooterItem,
  type HeaderFooterPosition,
} from "../../../domain/settings/header-footer-settings";
import { isMobileOS } from "../../../platform/environment";
import { headerFooterSettingsAtom } from "../../../state/ui";
import {
  hideHeaderFooterItem,
  hiddenHeaderFooterItems,
  moveHeaderFooterItem,
  showHeaderFooterItem,
} from "../lib/header-footer-arrangement";
import { useHeaderFooterDrag, type HfDragTarget } from "../hooks/useHeaderFooterDrag";

const ITEM_ICONS: Record<HeaderFooterItem, ReactNode> = {
  chapter: <BookOpenText size={13} aria-hidden="true" />,
  bookTitle: <Book size={13} aria-hidden="true" />,
  progress: <Percent size={13} aria-hidden="true" />,
  pages: <Files size={13} aria-hidden="true" />,
  time: <Clock size={13} aria-hidden="true" />,
  battery: <BatteryHigh size={13} aria-hidden="true" />,
};

/** The strips' on/off switch, shown beside the Customize group title. */
export function HeaderFooterEnabledToggle() {
  const { t } = useTranslation("settings");
  const [settings, setSettings] = useAtom(headerFooterSettingsAtom);
  return (
    <Toggle
      className="ml-auto"
      aria-label={t("menus.headerFooter.enabled.title")}
      checked={settings.enabled}
      onChange={(enabled) => setSettings({ ...settings, enabled })}
    />
  );
}

export function HeaderFooterEditor() {
  const { t } = useTranslation("settings");
  const rootRef = useRef<HTMLDivElement>(null);
  const [settings, setSettings] = useAtom(headerFooterSettingsAtom);
  const batteryOffered = isMobileOS();
  const hidden = hiddenHeaderFooterItems(settings).filter((item) => item !== "battery" || batteryOffered);
  const { draggingItem, ghost, dropTarget } = useHeaderFooterDrag(rootRef, (item, target) =>
    setSettings(moveHeaderFooterItem(settings, item, target.zone, target.beforeItem)),
  );
  const disabled = !settings.enabled;

  const zoneHighlighted = (zone: HfDragTarget["zone"]) => draggingItem !== null && dropTarget?.zone === zone;

  const chip = (item: HeaderFooterItem, shown: boolean) => (
    <span
      key={item}
      data-hf-item={item}
      role="listitem"
      className={cn(
        "inline-flex min-w-0 max-w-full cursor-grab select-none items-center gap-1 rounded-md border border-border bg-[var(--ra-main-surface-color)] px-1.5 py-0.5 font-sans text-xs text-fg",
        "[touch-action:none]",
        draggingItem === item && "opacity-40",
        disabled && "cursor-default",
      )}
    >
      <span className="shrink-0 text-fg-muted">{ITEM_ICONS[item]}</span>
      <span className="min-w-0 truncate">{t(`menus.headerFooter.items.${item}`)}</span>
      <IconButton
        size="sm"
        icon={shown ? <EyeSlash size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
        label={t(shown ? "menus.headerFooter.hideItem" : "menus.headerFooter.showItem", {
          item: t(`menus.headerFooter.items.${item}`),
        })}
        disabled={disabled}
        onClick={() => setSettings(shown ? hideHeaderFooterItem(settings, item) : showHeaderFooterItem(settings, item))}
        className="-my-0.5 -mr-1 h-5 w-5 shrink-0"
      />
    </span>
  );

  const dropZone = (position: HeaderFooterPosition, align: "start" | "center" | "end") => (
    <div
      data-hf-zone={position}
      aria-label={t(`menus.headerFooter.positions.${position}`)}
      className={cn(
        "flex min-h-7 min-w-0 flex-1 flex-wrap items-center gap-1 rounded-md px-1 py-0.5",
        align === "center" && "justify-center",
        align === "end" && "justify-end",
        settings.slots[position].length === 0 && "border border-dashed border-border",
        zoneHighlighted(position) && "bg-fg/5",
      )}
    >
      {settings.slots[position].filter((item) => item !== "battery" || batteryOffered).map((item) => chip(item, true))}
    </div>
  );

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      <div aria-disabled={disabled} className={cn("flex flex-col gap-2", disabled && "pointer-events-none opacity-50")}>
        {/* Miniature page: header band, body, footer band. */}
        <div className="rounded-lg border border-border bg-[var(--ra-main-surface-color)] p-1.5">
          <div className="flex gap-1">
            {dropZone("header-left", "start")}
            {dropZone("header-center", "center")}
            {dropZone("header-right", "end")}
          </div>
          <div aria-hidden="true" className="flex flex-col gap-1.5 px-2 py-3">
            <div className="h-1.5 w-full rounded bg-fg/10" />
            <div className="h-1.5 w-11/12 rounded bg-fg/10" />
            <div className="h-1.5 w-full rounded bg-fg/10" />
            <div className="h-1.5 w-4/5 rounded bg-fg/10" />
          </div>
          <div className="flex gap-1">
            {dropZone("footer-left", "start")}
            {dropZone("footer-center", "center")}
            {dropZone("footer-right", "end")}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            data-hf-zone="hidden"
            aria-label={t("menus.headerFooter.notShown")}
            className={cn(
              "flex min-h-9 flex-1 flex-wrap items-center gap-1 rounded-lg border border-dashed border-border px-1.5 py-1",
              zoneHighlighted("hidden") && "bg-fg/5",
            )}
          >
            {hidden.length === 0 ? (
              <span className="px-1 font-sans text-xs text-fg-subtle">—</span>
            ) : (
              hidden.map((item) => chip(item, false))
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => setSettings({ ...settings, slots: { ...defaultSlots } })}
          >
            {t("menus.reset")}
          </Button>
        </div>
      </div>

      {/* Drag ghost following the pointer. */}
      {ghost && (
        <span
          aria-hidden="true"
          className="pointer-events-none fixed z-[90] inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-md border border-border bg-[var(--ra-main-surface-color)] px-1.5 py-0.5 font-sans text-xs text-fg shadow-md"
          style={{ left: ghost.x, top: ghost.y }}
        >
          <span className="text-fg-muted">{ITEM_ICONS[ghost.item]}</span>
          <span className="max-w-24 truncate">{t(`menus.headerFooter.items.${ghost.item}`)}</span>
        </span>
      )}
    </div>
  );
}

const defaultSlots = defaultHeaderFooterSettings().slots;
