import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { cn } from "./lib/cn";

type RadioProps = {
  label: string;
  description?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "id">;

export const Radio = forwardRef<HTMLInputElement, RadioProps>(
  function Radio({ label, description, className, ...props }, ref) {
    const id = useId();

    return (
      <div className={cn("flex items-start gap-3", className)}>
        <input
          ref={ref}
          id={id}
          type="radio"
          aria-describedby={description ? `${id}-desc` : undefined}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer appearance-none rounded-full border border-stone-300 bg-transparent checked:border-[5px] checked:border-stone-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950"
          {...props}
        />
        <div className="flex flex-col">
          <label htmlFor={id} className="cursor-pointer text-sm text-stone-950">
            {label}
          </label>
          {description && (
            <p id={`${id}-desc`} className="text-caption text-stone-500">
              {description}
            </p>
          )}
        </div>
      </div>
    );
  },
);
