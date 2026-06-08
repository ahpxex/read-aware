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
            "font-sans text-eyebrow font-medium uppercase tracking-eyebrow",
            hasError ? "text-red-700" : "text-stone-600",
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
            "resize-y bg-transparent font-sans text-base text-stone-950 outline-none placeholder:text-stone-400",
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
          )}
          {...props}
        />
        {hasError && (
          <p id={`${id}-error`} className="text-[11px] leading-tight text-red-700">
            {error}
          </p>
        )}
        {!hasError && helperText && (
          <p id={`${id}-helper`} className="text-[11px] leading-tight text-stone-600">
            {helperText}
          </p>
        )}
      </div>
    );
  },
);
