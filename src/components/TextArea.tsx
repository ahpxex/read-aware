import { forwardRef, useId, type TextareaHTMLAttributes } from "react";
import { cn } from "./lib/cn";

type TextAreaProps = {
  label: string;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id">;

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea({ label, className, ...props }, ref) {
    const id = useId();
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <label
          htmlFor={id}
          className="font-sans text-eyebrow font-medium uppercase tracking-eyebrow text-stone-500"
        >
          {label}
        </label>
        <textarea
          ref={ref}
          id={id}
          className="resize-y border-b border-border bg-transparent pb-2 font-sans text-base text-stone-950 outline-none placeholder:text-stone-400 focus:border-stone-950"
          rows={3}
          {...props}
        />
      </div>
    );
  },
);
