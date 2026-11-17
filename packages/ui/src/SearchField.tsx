import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { forwardRef, type InputHTMLAttributes } from "react";
import { IconButton } from "./IconButton";
import { cn } from "./lib/cn";

/**
 * A search that can be put away (one opened from a search icon): a trailing
 * close control replaces the browser's own clear button, and Escape closes
 * too — without reaching an enclosing dialog's Escape. The caller decides what
 * closing means, typically clearing the query and showing the icon again.
 */
type DismissProps =
  | { onDismiss: () => void; dismissLabel: string }
  | { onDismiss?: undefined; dismissLabel?: undefined };

type SearchFieldProps = {
  /** Accessible name; search fields intentionally have no visible label. */
  label: string;
  size?: "sm" | "md";
  /** Plain fields inherit the surrounding search surface's border and spacing. */
  variant?: "outlined" | "plain";
} & DismissProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "aria-label" | "size">;

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { label, size = "md", variant = "outlined", className, onDismiss, dismissLabel, onKeyDown, ...props },
  ref,
) {
  return (
    <label
      className={cn(
        "flex items-center gap-2 transition-colors",
        variant === "outlined" &&
          cn(
            "rounded-control border border-border bg-[var(--ra-main-surface-color)] focus-within:border-fg-subtle",
            size === "sm" ? "px-2.5 py-1.5" : "px-3 py-2",
          ),
        variant === "plain" && "border-0 bg-transparent p-0",
        className,
      )}
    >
      <MagnifyingGlass size={size === "sm" ? 14 : 16} className="shrink-0 text-fg-subtle" aria-hidden="true" />
      <input
        ref={ref}
        type="search"
        aria-label={label}
        className={cn(
          "w-full appearance-none rounded-none bg-transparent font-sans text-fg outline-none placeholder:text-fg-subtle",
          size === "sm" ? "text-sm" : "text-base",
          // The close control below already clears; a second, browser-styled
          // clear button beside it would only compete with it.
          onDismiss && "[&::-webkit-search-cancel-button]:hidden",
        )}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!onDismiss || event.key !== "Escape" || event.defaultPrevented) return;
          event.stopPropagation();
          onDismiss();
        }}
        {...props}
      />
      {onDismiss && (
        <IconButton
          size="sm"
          label={dismissLabel}
          onClick={onDismiss}
          className="-my-1 shrink-0"
          icon={<X size={size === "sm" ? 13 : 15} aria-hidden="true" />}
        />
      )}
    </label>
  );
});

SearchField.displayName = "SearchField";
