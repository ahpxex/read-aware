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
  icon: ReactNode;
  run: () => void;
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
      panelClassName="max-h-72 w-56 overflow-y-auto p-1"
    >
      <ul className="flex flex-col">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                entry.run();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg transition-colors hover:bg-fg/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
            >
              <span className="text-fg-muted">{entry.icon}</span>
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
