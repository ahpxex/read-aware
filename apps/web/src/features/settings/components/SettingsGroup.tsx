import type { ReactNode } from "react";
import { cn } from "@read-aware/ui/cn";

type SettingsGroupProps = {
  title?: string;
  description?: ReactNode;
  /** Trailing element shown next to the title (e.g. a status badge). */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** A titled cluster of related settings rows or controls within a page. */
export function SettingsGroup({
  title,
  description,
  aside,
  children,
  className,
}: SettingsGroupProps) {
  return (
    <section className={cn("min-w-0", className)}>
      {(title || aside) && (
        <div className="mb-3 flex items-center gap-2">
          {title && (
            <h2 className="font-sans text-[13px] font-medium text-fg-muted">
              {title}
            </h2>
          )}
          {aside}
        </div>
      )}
      {description && (
        <p className="mb-3 -mt-1 font-sans text-[13px] leading-5 text-fg-muted">
          {description}
        </p>
      )}
      <div className="min-w-0">{children}</div>
    </section>
  );
}
