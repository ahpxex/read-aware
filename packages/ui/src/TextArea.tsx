import { forwardRef, useId, type TextareaHTMLAttributes } from "react";
import { cn } from "./lib/cn";

type TextAreaProps = {
  label: string;
  /** Keep the label for assistive tech only — for a field whose surface
   *  already says what it is (a note card under its passage). */
  hideLabel?: boolean;
  helperText?: string;
  error?: string;
  /** `plain` has no rule or border and no resize grip: the field is the
   *  surface it sits on, like writing straight onto a card. */
  variant?: "underline" | "outlined" | "plain";
  /** `sm` sets the text in the small body size, for compact surfaces. */
  size?: "sm" | "md";
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id">;

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hideLabel = false, helperText, error, variant = "underline", size = "md", className, ...props },
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
          hideLabel && "sr-only",
        )}
      >
        {label}
      </label>
      <textarea
        ref={ref}
        id={id}
        rows={3}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? `${id}-error` : helperText ? `${id}-helper` : undefined}
        className={cn(
          "bg-transparent font-sans text-fg outline-none placeholder:text-fg-subtle",
          size === "sm" ? "text-sm leading-relaxed" : "text-base",
          variant === "plain" ? "resize-none" : "resize-y",
          variant === "underline" &&
            cn("border-b pb-2", hasError ? "border-red-400 focus:border-red-600" : "border-border focus:border-fg"),
          variant === "outlined" &&
            cn("border px-3 py-2", hasError ? "border-red-400 focus:border-red-600" : "border-border focus:border-fg"),
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
});
