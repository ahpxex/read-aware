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
  accessories?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  selected?: boolean;
  disclosure?: "chevron" | "none";
  className?: string;
};

export function ItemList({ children, className }: ItemListProps) {
  return <ul className={cn("divide-y divide-border/60", className)}>{children}</ul>;
}

const ItemListItem = forwardRef<HTMLButtonElement, ItemListItemProps>(
  function ItemListItem(
    {
      title,
      subtitle,
      icon,
      accessories,
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
        {icon && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center text-fg-muted">
            {icon}
          </span>
        )}
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

    return (
      <li className={className}>
        {onClick ? (
          <button
            ref={ref}
            type="button"
            disabled={disabled}
            aria-current={selected || undefined}
            onClick={onClick}
            className={cn(
              "flex w-full items-center gap-3 px-2 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-fg disabled:opacity-40",
              selected ? "bg-fill" : "hover:bg-fg/5",
            )}
          >
            {content}
          </button>
        ) : (
          <div className="flex w-full items-center gap-3 px-2 py-2.5">{content}</div>
        )}
      </li>
    );
  },
);

ItemListItem.displayName = "ItemList.Item";
ItemList.Item = ItemListItem;
