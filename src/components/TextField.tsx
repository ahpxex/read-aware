import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "./lib/cn";

type TextFieldProps = {
  label: string;
  helperText?: string;
  error?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  variant?: "underline" | "outlined";
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id">;

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField(
    {
      label,
      helperText,
      error,
      leadingIcon,
      trailingIcon,
      variant = "underline",
      className,
      ...props
    },
    ref,
  ) {
    const id = useId();
    const hasError = !!error;

    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <label
          htmlFor={id}
          className={cn(
            "font-sans text-eyebrow font-medium uppercase tracking-eyebrow",
            hasError ? "text-red-700" : "text-stone-600",
          )}
        >
          {label}
        </label>
        <div className="relative flex items-center">
          {leadingIcon && (
            <span className="pointer-events-none absolute left-0 text-stone-400">
              {leadingIcon}
            </span>
          )}
          <input
            ref={ref}
            id={id}
            aria-invalid={hasError || undefined}
            aria-describedby={
              hasError ? `${id}-error` : helperText ? `${id}-helper` : undefined
            }
            className={cn(
              "w-full bg-transparent font-sans text-base text-stone-950 outline-none placeholder:text-stone-400",
              variant === "underline" &&
                cn(
                  "border-b pb-2",
                  hasError
                    ? "border-red-400 focus:border-red-600"
                    : "border-border focus:border-stone-950",
                ),
              variant === "outlined" &&
                cn(
                  "border px-3 py-2",
                  hasError
                    ? "border-red-400 focus:border-red-600"
                    : "border-border focus:border-stone-950",
                ),
              leadingIcon && (variant === "underline" ? "pl-6" : "pl-9"),
              trailingIcon && (variant === "underline" ? "pr-6" : "pr-9"),
            )}
            {...props}
          />
          {trailingIcon && (
            <span className="pointer-events-none absolute right-0 text-stone-400">
              {trailingIcon}
            </span>
          )}
        </div>
        {hasError && (
          <p id={`${id}-error`} className="text-caption text-red-700">
            {error}
          </p>
        )}
        {!hasError && helperText && (
          <p id={`${id}-helper`} className="text-caption text-stone-500">
            {helperText}
          </p>
        )}
      </div>
    );
  },
);
