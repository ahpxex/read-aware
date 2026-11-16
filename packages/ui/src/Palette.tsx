import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "./lib/cn";
import { SearchField } from "./SearchField";

type PaletteProps = {
  open: boolean;
  /** Escape, a press on the backdrop. */
  onClose: () => void;
  /** The search field's label and placeholder. */
  searchLabel: string;
  query: string;
  onQueryChange: (query: string) => void;
  maxQueryLength?: number;
  /** The highlighted option's index (`PaletteOption` `index`), kept in view. */
  selectedIndex: number;
  /** ↑ / ↓: the caller moves the highlight (it knows which options it may skip). */
  onMove: (direction: 1 | -1) => void;
  /** Enter: run the highlighted option. */
  onRun: () => void;
  /** A run is in flight: the panel reports busy. */
  busy?: boolean;
  /** The groups and options, or an empty state. */
  children: ReactNode;
  /** A quiet line under the list: counts, key hints. */
  footer?: ReactNode;
};

/**
 * A command-palette surface: a search field over a keyboard-driven list,
 * centered high on the window above a dimmed backdrop. The search has focus;
 * ↑/↓ move the highlight, Enter runs it, Escape closes. The caller owns the
 * options (`PaletteGroup`, `PaletteOption`), the highlight and what running
 * means, so one frame serves the command center and narrower pickers alike.
 * Portaled to the body, so it lays out against the viewport from anywhere.
 */
export function Palette({
  open,
  onClose,
  searchLabel,
  query,
  onQueryChange,
  maxQueryLength = 4096,
  selectedIndex,
  onMove,
  onRun,
  busy = false,
  children,
  footer,
}: PaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const keys = useRef({ onClose, onMove, onRun });
  keys.current = { onClose, onMove, onRun };

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(id);
  }, [open]);

  // Modal: focus that lands outside the palette (a window regaining focus
  // restores the page's last field, a click behind the backdrop) comes back
  // to the search, so typing never reaches the page underneath.
  useEffect(() => {
    if (!open) return;
    function onFocusIn(event: FocusEvent) {
      const target = event.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      inputRef.current?.focus();
    }
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open]);

  // On the document, so the palette handles its keys before any page-level
  // window listener (a surface's own Escape) sees them.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        keys.current.onClose();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        keys.current.onMove(event.key === "ArrowDown" ? 1 : -1);
      } else if (
        event.key === "Enter" &&
        !event.isComposing &&
        // A focused button (an option's action) keeps its own Enter.
        !(event.target instanceof HTMLButtonElement)
      ) {
        event.preventDefault();
        keys.current.onRun();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-palette-index="${selectedIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, selectedIndex, children]);

  if (!open) return null;

  return createPortal(
    <div
      data-ui-portal=""
      className="ra-scrim fixed inset-0 z-50 flex items-start justify-center bg-stone-950/35 px-4 py-[15vh] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={searchLabel}
        aria-busy={busy}
        className={cn(
          "flex max-h-full w-full max-w-xl flex-col rounded-md border border-border bg-[var(--ra-main-surface-color)]",
          "shadow-[0_12px_32px_rgba(28,25,23,0.15)]",
          "animate-in fade-in slide-in-from-top-2 duration-200",
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
          <SearchField
            ref={inputRef}
            variant="plain"
            label={searchLabel}
            value={query}
            maxLength={maxQueryLength}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={searchLabel}
            className="w-full"
          />
        </div>
        <div ref={listRef} className="ra-scrollarea max-h-[55vh] min-h-0 overflow-y-auto py-2">
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-2 text-xs text-fg-subtle">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** A labelled run of options. */
export function PaletteGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-1">
      <div className="px-4 pt-2 pb-1 text-xs lowercase text-fg-subtle">{label}</div>
      {children}
    </div>
  );
}

type PaletteOptionProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children"> & {
  /** Position in the caller's flat option order (the highlight's index). */
  index: number;
  selected: boolean;
  onRun: () => void;
  /** The pointer moved over it: the caller highlights it. */
  onHover: () => void;
  children: ReactNode;
  /** Controls beside the option (a delete, say), shown while it is hovered or
   *  highlighted. They sit next to the option's button, never inside it. */
  actions?: ReactNode;
};

/**
 * One option: highlighted with a bar at its start, ↵ at its end when it can
 * run (actions take that place when given).
 */
export function PaletteOption({
  index,
  selected,
  onRun,
  onHover,
  children,
  actions,
  disabled,
  className,
  ...props
}: PaletteOptionProps) {
  return (
    <div
      className="group/palette-option relative"
      onMouseMove={() => {
        if (!disabled) onHover();
      }}
    >
      <button
        type="button"
        data-palette-index={index}
        aria-selected={selected}
        disabled={disabled}
        onClick={onRun}
        className={cn(
          "relative flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
          selected ? "bg-fg/[0.07]" : "hover:bg-fg/[0.04]",
          disabled && "cursor-default opacity-50",
          actions && "pr-12",
          className,
        )}
        {...props}
      >
        {selected && <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-fg" aria-hidden="true" />}
        {children}
        {selected && !disabled && !actions && (
          <span className="shrink-0 text-xs text-fg-subtle" aria-hidden="true">
            ↵
          </span>
        )}
      </button>
      {actions && (
        <div
          className={cn(
            "absolute inset-y-0 right-3 flex items-center opacity-0 group-hover/palette-option:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100",
            selected && "opacity-100",
          )}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
