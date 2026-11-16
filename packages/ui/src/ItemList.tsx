import { CaretRight } from "@phosphor-icons/react";
import { forwardRef, type ReactNode } from "react";
import { cn } from "./lib/cn";
import { Stack } from "./Stack";
import { Body } from "./typography/Body";
import { Caption } from "./typography/Caption";

type ItemListProps = {
  children: ReactNode;
  className?: string;
};

type ItemListItemProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  /**
   * Passive trailing content — tags, status icons, a spinner. It renders inside
   * the row's button when the row is clickable, so it must not be interactive.
   */
  accessories?: ReactNode;
  /**
   * Interactive trailing controls (an IconButton, a menu). They render beside
   * the row's button rather than inside it — a button cannot hold another —
   * and stay their own tab stops; the row keeps one hover and selected fill.
   */
  actions?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  selected?: boolean;
  disclosure?: "chevron" | "none";
  className?: string;
};

export function ItemList({ children, className }: ItemListProps) {
  return <ul className={cn("divide-y divide-border/60", className)}>{children}</ul>;
}

const ItemListItem = forwardRef<HTMLButtonElement, ItemListItemProps>(function ItemListItem(
  {
    title,
    subtitle,
    icon,
    accessories,
    actions,
    onClick,
    disabled,
    selected = false,
    disclosure = "chevron",
    className,
  },
  ref,
) {
  const content = (
    <>
      {icon && <span className="flex h-7 w-7 shrink-0 items-center justify-center text-fg-muted">{icon}</span>}
      <span className="min-w-0 flex-1">
        <Body as="span" className="block truncate text-sm text-fg">
          {title}
        </Body>
        {subtitle && (
          <Caption as="span" className="mt-0.5 block truncate text-fg-subtle">
            {subtitle}
          </Caption>
        )}
      </span>
      {accessories && (
        <Stack direction="horizontal" gap="sm" align="center" className="shrink-0">
          {accessories}
        </Stack>
      )}
      {onClick && disclosure === "chevron" && (
        <CaretRight size={14} className="shrink-0 text-fg-subtle" aria-hidden="true" />
      )}
    </>
  );

  const row = onClick ? (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-current={selected || undefined}
      onClick={onClick}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 py-2.5 pl-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-fg disabled:opacity-40",
        actions ? "flex-1 pr-1" : "pr-2",
        // With actions the fill belongs to the whole row (below), so hovering
        // a trailing control still reads as hovering this row.
        !actions && (selected ? "bg-fill" : "hover:bg-fg/5"),
      )}
    >
      {content}
    </button>
  ) : (
    <div className={cn("flex w-full min-w-0 items-center gap-3 py-2.5 pl-2", actions ? "flex-1 pr-1" : "pr-2")}>
      {content}
    </div>
  );

  if (!actions) return <li className={className}>{row}</li>;
  return (
    <li
      className={cn(
        "flex items-center transition-colors",
        selected ? "bg-fill" : onClick && "hover:bg-fg/5",
        className,
      )}
    >
      {row}
      <Stack direction="horizontal" gap="sm" align="center" className="shrink-0 pr-2">
        {actions}
      </Stack>
    </li>
  );
});

ItemListItem.displayName = "ItemList.Item";
ItemList.Item = ItemListItem;
