import { type ReactNode } from "react";
import { cn } from "./lib/cn";

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 text-center",
        className,
      )}
    >
      {icon && <div className="mb-4 text-stone-300">{icon}</div>}
      <h3 className="font-sans text-base font-semibold text-stone-950">
        {title}
      </h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-stone-600">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
