/**
 * The generic vertical-dots overflow menu every customizable surface shares:
 * items the user didn't place inline live here, core and plugin alike.
 * Entries are plain {label, icon, run} — the surface decides what running
 * means (callback, dialog, navigation).
 */
import { DotsThreeVertical } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { Popover } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";

export type MenuOverflowEntry = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Plain action: runs and closes the menu. */
  run?: () => void;
  /** Widget row: rendered as-is (label + the widget's own trigger); its
   *  popover opens inside this panel, so the menu stays open. */
  node?: ReactNode;
};

type MenuOverflowProps = {
  entries: MenuOverflowEntry[];
  /** Extra classes on the Popover root (e.g. pointer-events fixes). */
  className?: string;
  align?: "left" | "right";
  /** Compact trigger for dense bars (selection menu). */
  size?: "sm" | "md";
};

export function MenuOverflow({
  entries,
  className,
  align = "right",
  size = "md",
}: MenuOverflowProps) {
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
        entries.some((entry) => entry.node)
          ? "w-56 overflow-visible p-1"
          : "max-h-72 w-56 overflow-y-auto p-1"
      }
    >
      <ul className="flex flex-col">
        {entries.map((entry) => (
          <li key={entry.id}>
            {entry.node ? (
              // Reads exactly like an action row; the widget's real trigger is
              // hidden inside and clicked through, its popover anchoring here.
              <div className="relative">
                <button
                  type="button"
                  onClick={(event) => {
                    const host = event.currentTarget.nextElementSibling;
                    host?.querySelector("button")?.click();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg transition-colors hover:bg-fg/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
                >
                  <span className="text-fg-muted">{entry.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                </button>
                <span className="absolute right-1 top-full [&>div>button]:hidden [&>div>span]:hidden">
                  {entry.node}
                </span>
              </div>
            ) : (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                entry.run?.();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg transition-colors hover:bg-fg/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
            >
              <span className="text-fg-muted">{entry.icon}</span>
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            </button>
            )}
          </li>
        ))}
      </ul>
    </Popover>
  );
}
