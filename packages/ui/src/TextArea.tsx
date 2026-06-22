import { forwardRef, useId, type TextareaHTMLAttributes } from "react";
import { cn } from "./lib/cn";

type TextAreaProps = {
  label: string;
  helperText?: string;
  error?: string;
  variant?: "underline" | "outlined";
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id">;

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea(
    { label, helperText, error, variant = "underline", className, ...props },
    ref,
  ) {
    const id = useId();
    const hasError = !!error;

    return (
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label
          htmlFor={id}
          className={cn(
            "font-sans text-[13px] font-medium",
            hasError ? "text-red-700 dark:text-red-400" : "text-fg-muted",
          )}
        >
          {label}
        </label>
        <textarea
          ref={ref}
          id={id}
          rows={3}
          aria-invalid={hasError || undefined}
          aria-describedby={
            hasError ? `${id}-error` : helperText ? `${id}-helper` : undefined
          }
          className={cn(
            "resize-y bg-transparent font-sans text-base text-fg outline-none placeholder:text-fg-subtle",
            variant === "underline" &&
              cn(
                "border-b pb-2",
                hasError
                  ? "border-red-400 focus:border-red-600"
                  : "border-border focus:border-fg",
              ),
            variant === "outlined" &&
              cn(
                "border px-3 py-2",
                hasError
                  ? "border-red-400 focus:border-red-600"
                  : "border-border focus:border-fg",
              ),
          )}
          {...props}
        />
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
  },
);
