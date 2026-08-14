import type { ReactNode } from "react";
import { cn } from "@read-aware/ui/cn";

type SettingsRowProps = {
  title: ReactNode;
  description?: ReactNode;
  /** The control rendered on the trailing edge (toggle, select, button). */
  control?: ReactNode;
  /** Drop the hairline divider above this row (used for the first row in a list). */
  borderless?: boolean;
  className?: string;
};

/** A label/description pair with a trailing control, divided by a hairline. */
export function SettingsRow({
  title,
  description,
  control,
  borderless,
  className,
}: SettingsRowProps) {
  return (
    <div
      className={cn(
        // flex-wrap + a minimum basis on the text column: when the row is too
        // narrow for label + control side by side (settings inside a mobile
        // sheet), the control drops to its own line instead of overflowing.
        "flex flex-wrap items-start justify-between gap-x-6 gap-y-2 py-3.5",
        !borderless && "border-t border-border",
        className,
      )}
    >
      <div className="min-w-0 flex-1 basis-52">
        <p className="font-sans text-sm font-medium text-fg">{title}</p>
        {description && (
          <p className="mt-0.5 font-sans text-[13px] leading-5 text-fg-muted">{description}</p>
        )}
      </div>
      {control && <div className="ml-auto flex max-w-full items-center pt-0.5">{control}</div>}
    </div>
  );
}
