import { type ReactNode } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { Button } from "./Button";
import { cn } from "./lib/cn";

type InlineErrorProps = {
  /** Short failure statement ("Reply failed"). Omit in compact mode. */
  title?: string;
  /** Localized, user-facing body copy — never raw error text (house rule). */
  children: ReactNode;
  /** Re-attempt the failed action. Requires `retryLabel` (localized). */
  onRetry?: () => void;
  retryLabel?: string;
  /** Extra fix affordance (e.g. an "open settings" link), rendered after the body. */
  action?: ReactNode;
  /**
   * Single-line row treatment for dense surfaces (settings rows, status
   * lines): no card chrome, body + affordances inline.
   */
  compact?: boolean;
  className?: string;
};

/**
 * The one way to show a failure inside a surface. Errors keep the editorial
 * stone palette — a firmer border and full-value title carry the weight, no
 * red tint (the house style bans loud panels); `role="alert"` carries the
 * semantics for assistive tech.
 *
 * Rules of use (see CLAUDE.md → Error Handling):
 * - body copy comes from `describeError`/localized strings, never
 *   `error.message`;
 * - pass `onRetry` only when re-attempting can honestly succeed;
 * - transient failures belong in a destructive toast, persistent state here.
 */
export function InlineError({
  title,
  children,
  onRetry,
  retryLabel,
  action,
  compact = false,
  className,
}: InlineErrorProps) {
  const retry = onRetry && retryLabel && (
    <Button
      size="sm"
      variant="ghost"
      onClick={onRetry}
      className={cn(
        "h-7 shrink-0 gap-1 px-2 text-xs text-fg-muted hover:text-fg",
        !compact && "-my-1 -mr-1.5",
      )}
    >
      <ArrowsClockwise size={13} aria-hidden="true" />
      {retryLabel}
    </Button>
  );

  if (compact) {
    return (
      <span
        role="alert"
        className={cn("inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted", className)}
      >
        <span className="[overflow-wrap:anywhere]">{children}</span>
        {action}
        {retry}
      </span>
    );
  }

  return (
    <div
      role="alert"
      className={cn("max-w-full rounded-lg border border-border bg-fill/60 px-3.5 py-2.5", className)}
    >
      {(title || retry) && (
        <div className="flex items-center justify-between gap-3">
          {title && <p className="text-sm font-medium leading-5 text-fg">{title}</p>}
          {retry}
        </div>
      )}
      <div
        className={cn(
          "text-xs leading-relaxed text-fg-muted [overflow-wrap:anywhere]",
          (title || retry) && "mt-0.5",
        )}
      >
        {children}
        {action != null && <> {action}</>}
      </div>
    </div>
  );
}
