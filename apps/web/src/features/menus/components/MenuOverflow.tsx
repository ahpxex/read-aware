/**
 * The generic vertical-dots overflow menu every customizable surface shares:
 * items the user didn't place inline live here, core and plugin alike.
 * Entries are plain {label, icon, run} — the surface decides what running
 * means (callback, dialog, navigation).
 */
import { Check, DotsThreeVertical } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { Button, Popover } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";

export type MenuOverflowEntry = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Plain action: runs and closes the menu. */
  run?: () => void;
  /** Widget with its own trigger; its popover opens inside this panel, so the
   *  menu stays open. By default the widget sits beside the entry's label. */
  node?: ReactNode;
  /** A single-trigger widget can own the whole row, including its icon/label. */
  nodeLayout?: "accessory" | "row";
  /** Renders the row inert (e.g. import while an import is running). */
  disabled?: boolean;
  checked?: boolean;
};

type MenuOverflowProps = {
  entries: MenuOverflowEntry[];
  /** Extra classes on the Popover root (e.g. pointer-events fixes). */
  className?: string;
  align?: "left" | "right";
  /** Compact trigger for dense bars (selection menu). */
  size?: "sm" | "md";
};

export function MenuOverflow({ entries, className, align = "right", size = "md" }: MenuOverflowProps) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align={align}
      triggerLabel={t("menus.more")}
      triggerTooltip={t("menus.more")}
      className={className}
      trigger={
        <span
          className={cn(
            "flex items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg",
            size === "md" ? "h-8 w-8" : "h-7 w-7",
          )}
        >
          <DotsThreeVertical size={size === "md" ? 18 : 16} weight="bold" aria-hidden="true" />
        </span>
      }
      // Widget rows open their own popover FROM this panel — it must not clip,
      // so the nested panel grows outward past the menu bounds. Scroll capping
      // only applies to plain action lists.
      panelClassName={
        entries.some((entry) => Boolean(entry.node)) ? "w-56 overflow-visible p-1" : "max-h-72 w-56 overflow-y-auto p-1"
      }
    >
      <ul className="flex flex-col">
        {entries.map((entry) => (
          <li key={entry.id}>
            {entry.node && entry.nodeLayout === "row" ? (
              entry.node
            ) : entry.node ? (
              // Keep the widget's real trigger visible and keyboard reachable.
              // Some widgets contain multiple actions (e.g. reader modes), so
              // relaying a click to their first DOM button loses behavior.
              <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5">
                <span className="flex min-w-0 items-center gap-2 text-sm text-fg">
                  <span className="text-fg-muted">{entry.icon}</span>
                  <span className="truncate">{entry.label}</span>
                </span>
                <div className="shrink-0">{entry.node}</div>
              </div>
            ) : (
              <Button
                type="button"
                disabled={entry.disabled}
                aria-pressed={entry.checked}
                onClick={() => {
                  setOpen(false);
                  entry.run?.();
                }}
                variant="ghost"
                size="sm"
                className="w-full justify-start rounded-md px-2 text-left"
              >
                <span className="text-fg-muted">{entry.icon}</span>
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.checked && <Check size={16} aria-hidden="true" className="shrink-0" />}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Popover>
  );
}
