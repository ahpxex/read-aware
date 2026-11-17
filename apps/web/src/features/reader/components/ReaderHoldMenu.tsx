import { DotsThree } from "@phosphor-icons/react";
import { useEffect, useMemo, type ReactNode, type RefObject } from "react";
import { DropdownMenu, IconButton } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useAnchoredMenuPosition } from "../hooks/useAnchoredMenuPosition";
import type { HoldMenuState } from "../hooks/useReaderHoldMenu";

export type HoldMenuAction = {
  id: string;
  label: string;
  icon: ReactNode;
  run: () => void;
  disabled?: boolean;
  pressed?: boolean;
};

export type HoldMenuMoreItem = {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  checked?: boolean;
};

type ReaderHoldMenuProps = {
  state: HoldMenuState;
  /** Accessible name of the menu (the mode's title). */
  title: string;
  /** First tier: the resting unit's actions, drawn as a row of icons. */
  actions: HoldMenuAction[];
  /** Second tier behind the trailing "more" action. */
  moreLabel: string;
  moreItems: HoldMenuMoreItem[];
  /** The row element, so the gesture can hit-test the actions. */
  menuRef: RefObject<HTMLDivElement | null>;
  onMoreOpenChange: (open: boolean) => void;
  onClose: () => void;
};

/**
 * The touch reader's hold menu in text-unit mode: a row of the resting unit's
 * actions anchored where the finger rests, with the mode's navigation and
 * panels one tier behind "more". While the opening finger is still down the
 * action under it is raised and named; lifting runs it. Once the finger has
 * lifted in place the same row works by taps.
 */
export function ReaderHoldMenu({
  state,
  title,
  actions,
  moreLabel,
  moreItems,
  menuRef,
  onMoreOpenChange,
  onClose,
}: ReaderHoldMenuProps) {
  // Stable per anchor: the positioning hook re-measures whenever this changes.
  const anchor = state.anchor;
  const anchorRect = useMemo(() => (anchor ? { left: anchor.x, top: anchor.y, width: 1, height: 1 } : null), [anchor]);
  const { containerRef, menuRef: positionedRef, position } = useAnchoredMenuPosition(anchorRect);
  const hoveredAction =
    state.hovered == null ? null : state.hovered < actions.length ? (actions[state.hovered] ?? null) : null;
  const hoveredLabel = state.hovered == null ? null : hoveredAction ? hoveredAction.label : moreLabel;

  // A tap outside the row (on the app's chrome) dismisses a resting menu; taps
  // on book content are handled by the reader's own click routing.
  useEffect(() => {
    if (!state.anchor || state.sliding) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (positionedRef.current?.contains(target) || (target instanceof Element && target.closest("[data-ui-portal]")))
      )
        return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose, positionedRef, state.anchor, state.sliding]);

  if (!anchorRect) return null;

  const actionButtonClass =
    "rounded-control text-fg-muted hover:bg-fg/5 hover:text-fg focus-visible:ring-fg disabled:pointer-events-none disabled:opacity-40 h-10 w-10";
  const raised = "bg-fill-strong text-fg scale-110";

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <div
        ref={positionedRef}
        className="ra-motion-overlay-pop pointer-events-auto absolute flex flex-col items-center gap-1.5"
        style={position}
      >
        {/* Icons carry no visible text on touch; the raised action is named
            above the row while the finger chooses. */}
        <span
          aria-live="polite"
          className={cn(
            "rounded-mark bg-fg px-2 py-1 text-xs text-inverse-fg transition-opacity",
            state.sliding && hoveredLabel ? "opacity-100" : "opacity-0",
          )}
        >
          {hoveredLabel ?? " "}
        </span>
        <div className="relative">
          <div
            ref={menuRef}
            role="toolbar"
            aria-label={title}
            className="flex max-w-[calc(100vw-1.25rem)] items-center gap-0.5 rounded-surface border border-border bg-[var(--ra-main-surface-color)] p-1 shadow-[0_4px_16px_-6px_rgba(28,25,23,0.25)]"
          >
            {actions.map((action, index) => (
              <IconButton
                key={action.id}
                data-hold-item={index}
                label={action.label}
                size="sm"
                disabled={action.disabled}
                aria-pressed={action.pressed}
                onClick={() => {
                  onClose();
                  action.run();
                }}
                className={cn(
                  actionButtonClass,
                  action.pressed && "bg-fill-strong text-fg",
                  state.sliding && state.hovered === index && raised,
                )}
                icon={action.icon}
              />
            ))}
            <IconButton
              data-hold-item={actions.length}
              label={moreLabel}
              size="sm"
              aria-expanded={state.moreOpen}
              onClick={() => onMoreOpenChange(true)}
              className={cn(actionButtonClass, state.sliding && state.hovered === actions.length && raised)}
              icon={<DotsThree size={18} weight="bold" aria-hidden="true" />}
            />
          </div>
          {/* The second tier drops from the row; its items run and close. */}
          <div className="absolute right-0 top-full mt-1">
            <DropdownMenu
              align="right"
              side={position.top > 240 ? "top" : "bottom"}
              open={state.moreOpen}
              onOpenChange={(open) => {
                onMoreOpenChange(open);
                if (!open) onClose();
              }}
              items={moreItems.map((item) => ({
                ...item,
                onClick: () => {
                  onClose();
                  item.onClick();
                },
              }))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
