import { forwardRef, useId, type SelectHTMLAttributes } from "react";
import { cn } from "./lib/cn";

type SelectProps = {
  label: string;
  options: Array<{ label: string; value: string }>;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "children">;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ label, options, className, ...props }, ref) {
    const id = useId();
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <label
          htmlFor={id}
          className="font-sans text-eyebrow font-medium uppercase tracking-eyebrow text-stone-600"
        >
          {label}
        </label>
        <div className="relative">
          <select
            ref={ref}
            id={id}
            className="w-full appearance-none border-b border-border bg-transparent pb-2 pr-6 font-sans text-base text-stone-950 outline-none focus:border-stone-950"
            {...props}
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <svg
            className="pointer-events-none absolute right-0 bottom-3 h-4 w-4 text-stone-400"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </div>
      </div>
    );
  },
);
