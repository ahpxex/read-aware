import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { cn } from "./lib/cn";

type TextFieldProps = {
  label: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id">;

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField({ label, className, ...props }, ref) {
    const id = useId();
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <label
          htmlFor={id}
          className="font-sans text-eyebrow font-medium uppercase tracking-eyebrow text-stone-500"
        >
          {label}
        </label>
        <input
          ref={ref}
          id={id}
          className="border-b border-border bg-transparent pb-2 font-sans text-base text-stone-950 outline-none placeholder:text-stone-400 focus:border-stone-950"
          {...props}
        />
      </div>
    );
  },
);
