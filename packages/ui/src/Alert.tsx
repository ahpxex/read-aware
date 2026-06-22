import { type ReactNode } from "react";
import { cn } from "./lib/cn";

type AlertProps = {
  variant?: "default" | "destructive" | "success";
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
};

const variantClasses = {
  default: "border-border text-fg-muted",
  destructive:
    "border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200",
};

const titleClasses = {
  default: "text-fg",
  destructive: "text-red-950 dark:text-red-100",
  success: "text-emerald-950 dark:text-emerald-100",
};

export function Alert({
  variant = "default",
  title,
  children,
  action,
  className,
}: AlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 border px-4 py-3 text-sm",
        variantClasses[variant],
        className,
      )}
    >
      <div className="flex-1">
        {title && (
          <p className={cn("mb-1 font-medium", titleClasses[variant])}>
            {title}
          </p>
        )}
        <div>{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
