import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { cn } from "./lib/cn";

type CheckboxProps = {
  label: string;
  description?: string;
  error?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "id">;

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ label, description, error, className, "aria-describedby": describedBy, ...props }, ref) {
    const id = useId();

    return (
      <div className={cn("flex items-start gap-3", className)}>
        <input
          ref={ref}
          id={id}
          type="checkbox"
          aria-describedby={[describedBy, description ? `${id}-desc` : undefined, error ? `${id}-error` : undefined].filter(Boolean).join(" ") || undefined}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer appearance-none border border-border-strong bg-transparent checked:border-fg checked:bg-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg"
          {...props}
          aria-invalid={error ? true : props["aria-invalid"]}
        />
        <div className="flex min-w-0 flex-col [overflow-wrap:anywhere]">
          <label htmlFor={id} className="cursor-pointer text-sm text-fg">
            {label}
          </label>
          {description && (
            <p id={`${id}-desc`} className="text-caption text-fg-muted">
              {description}
            </p>
          )}
          {error && <p id={`${id}-error`} className="text-[11px] leading-tight text-red-700">{error}</p>}
        </div>
      </div>
    );
  },
);
