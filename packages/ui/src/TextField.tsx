import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "./lib/cn";

type TextFieldProps = {
  label: string;
  helperText?: string;
  error?: string;
  leadingIcon?: ReactNode;
  /** Decorative trailing icon; does not receive pointer events. */
  trailingIcon?: ReactNode;
  /** Interactive control rendered at the trailing edge of the field. */
  trailingAction?: ReactNode;
  variant?: "underline" | "outlined";
  /** Keep the label for assistive technology only, e.g. when a heading is edited in place. */
  hideLabel?: boolean;
  /** `display` sets the value in the serif display face, for editing a title in place. */
  textSize?: "body" | "display";
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id">;

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  {
    label,
    helperText,
    error,
    leadingIcon,
    trailingIcon,
    trailingAction,
    variant = "underline",
    hideLabel = false,
    textSize = "body",
    className,
    ...props
  },
  ref,
) {
  const id = useId();
  const hasError = !!error;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label
          htmlFor={id}
          className={cn(
            "font-sans text-[13px] font-medium",
            hasError ? "text-red-700 dark:text-red-400" : "text-fg-muted",
            hideLabel && "sr-only",
          )}
        >
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {leadingIcon && (
          <span
            className={cn("pointer-events-none absolute text-fg-subtle", variant === "outlined" ? "left-3" : "left-0")}
          >
            {leadingIcon}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? `${id}-error` : helperText ? `${id}-helper` : undefined}
          className={cn(
            "w-full bg-transparent text-fg outline-none placeholder:text-fg-subtle",
            textSize === "display" ? "font-serif text-2xl" : "font-sans text-base",
            variant === "underline" &&
              cn(
                "border-b pt-2 pb-2",
                hasError ? "border-red-400 focus:border-red-600" : "border-border focus:border-fg",
              ),
            variant === "outlined" &&
              cn(
                "rounded-control border px-3 py-2",
                hasError ? "border-red-400 focus:border-red-600" : "border-border focus:border-fg",
              ),
            leadingIcon && (variant === "underline" ? "pl-6" : "pl-9"),
            (trailingIcon || trailingAction) && (variant === "underline" ? "pr-8" : "pr-10"),
          )}
          {...props}
        />
        {trailingIcon && (
          <span
            className={cn(
              "pointer-events-none absolute text-fg-subtle",
              variant === "outlined" ? "right-3" : "right-0",
            )}
          >
            {trailingIcon}
          </span>
        )}
        {trailingAction && (
          <span className={cn("absolute", variant === "outlined" ? "right-1" : "right-0")}>{trailingAction}</span>
        )}
      </div>
      {hasError && (
        <p id={`${id}-error`} className="text-[11px] leading-tight text-red-700">
          {error}
        </p>
      )}
      {!hasError && helperText && (
        <p id={`${id}-helper`} className="text-[11px] leading-tight text-fg-muted">
          {helperText}
        </p>
      )}
    </div>
  );
});
