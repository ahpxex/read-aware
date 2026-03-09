import { forwardRef, useId, type SelectHTMLAttributes } from "react";
import { cn } from "./lib/cn";

type SelectProps = {
  label: string;
  options: Array<{ label: string; value: string }>;
  helperText?: string;
  error?: string;
  placeholder?: string;
  variant?: "underline" | "outlined";
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "children">;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    {
      label,
      options,
      helperText,
      error,
      placeholder,
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
        <div className="relative">
          <select
            ref={ref}
            id={id}
            aria-invalid={hasError || undefined}
            aria-describedby={
              hasError
                ? `${id}-error`
                : helperText
                  ? `${id}-helper`
                  : undefined
            }
            className={cn(
              "w-full appearance-none bg-transparent pr-6 font-sans text-base text-stone-950 outline-none",
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
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <svg
            className={cn(
              "pointer-events-none absolute right-0 h-4 w-4 text-stone-400",
              variant === "underline" ? "bottom-3" : "top-1/2 -translate-y-1/2",
            )}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
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
