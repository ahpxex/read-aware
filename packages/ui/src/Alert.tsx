import { type ReactNode } from "react";
import { cn } from "./lib/cn";

type AlertProps = {
  variant?: "default" | "destructive" | "success";
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
};

// Errors stay in the editorial stone palette — a firmer border and full-value
// title carry the weight; no tinted fills (the house style bans loud panels).
const variantClasses = {
  default: "border-border text-fg-muted",
  destructive: "border-border-strong bg-fill/60 text-fg-muted",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200",
};

const titleClasses = {
  default: "text-fg",
  destructive: "text-fg",
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
