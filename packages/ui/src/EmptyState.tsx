import { type ReactNode } from "react";
import { cn } from "./lib/cn";

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  /** "display" sets the title as a page's serif heading — for a surface whose
   *  empty state is the whole page (the Agent page's new conversation). */
  size?: "default" | "display";
  className?: string;
};

export function EmptyState({ icon, title, description, action, size = "default", className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 text-center", className)}>
      {icon && <div className="mb-4 text-fg-subtle">{icon}</div>}
      <h3
        className={cn(
          "text-fg",
          size === "display" ? "font-serif text-2xl leading-display" : "font-sans text-base font-semibold",
        )}
      >
        {title}
      </h3>
      {description && (
        <p className={cn("max-w-sm text-sm text-fg-muted", size === "display" ? "mt-3" : "mt-1.5")}>{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
