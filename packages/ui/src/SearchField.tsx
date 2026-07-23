import { MagnifyingGlass } from "@phosphor-icons/react";
import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "./lib/cn";

type SearchFieldProps = {
  /** Accessible name; search fields intentionally have no visible label. */
  label: string;
  size?: "sm" | "md";
} & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "aria-label" | "size">;

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(
  function SearchField({ label, size = "md", className, ...props }, ref) {
    return (
      <label
        className={cn(
          "flex items-center gap-2 rounded-md border border-border bg-[var(--ra-main-surface-color)] transition-colors focus-within:border-fg-subtle",
          size === "sm" ? "px-2.5 py-1.5" : "px-3 py-2",
          className,
        )}
      >
        <MagnifyingGlass
          size={size === "sm" ? 14 : 16}
          className="shrink-0 text-fg-subtle"
          aria-hidden="true"
        />
        <input
          ref={ref}
          type="search"
          aria-label={label}
          className={cn(
            "w-full bg-transparent font-sans text-fg outline-none placeholder:text-fg-subtle",
            size === "sm" ? "text-sm" : "text-base",
          )}
          {...props}
        />
      </label>
    );
  },
);

SearchField.displayName = "SearchField";
