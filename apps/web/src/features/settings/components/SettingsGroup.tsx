import type { ReactNode } from "react";
import { cn } from "@read-aware/ui/cn";

type SettingsGroupProps = {
  title?: string;
  description?: ReactNode;
  /** Trailing element shown next to the title (e.g. a status badge). */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  headingLevel?: 2 | 3 | 4;
};

/** A titled cluster of related settings rows or controls within a page. */
export function SettingsGroup({
  title,
  description,
  aside,
  children,
  className,
  headingLevel = 2,
}: SettingsGroupProps) {
  const HeadingTag = `h${headingLevel}` as "h2" | "h3" | "h4";

  return (
    <section className={cn("min-w-0", className)}>
      {(title || aside) && (
        <div className="mb-3 flex items-center gap-2">
          {title && (
            <HeadingTag className="font-sans text-[13px] font-medium text-fg-muted">
              {title}
            </HeadingTag>
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
