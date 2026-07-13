import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import type { RefObject } from "react";
import { IconButton } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { useDraggableFloat } from "../hooks/useDraggableFloat";

type ReaderNavigatorStepButtonsProps = {
  visible: boolean;
  /** Coordinate space the control floats in (the reader root). */
  containerRef: RefObject<HTMLElement | null>;
  onPrev: () => void;
  onNext: () => void;
};

/**
 * The sentence navigator's floating step control: previous / next joined into
 * one quiet strip — the same surface language as the action bar — with targets
 * sized for a thumb rather than a pointer. The pair drags as a single unit
 * (grab anywhere on it) and the spot sticks per device, across books. Shown
 * only on coarse-pointer devices; the desktop steps via the bar and keyboard.
 */
export function ReaderNavigatorStepButtons({
  visible,
  containerRef,
  onPrev,
  onNext,
}: ReaderNavigatorStepButtonsProps) {
  const { t } = useTranslation("reader");
  const float = useDraggableFloat({
    containerRef,
    controlId: "navigator-steps",
    defaultPosition: { x: 0.82, y: 0.66 },
  });
  if (!visible) return null;

  const stepButtonClass =
    "h-12 w-12 touch-none rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg focus-visible:ring-fg";
  const step = (action: () => void) => () => {
    // A drag that ends over a button still synthesizes a click — swallow it.
    if (float.consumeDragClick()) return;
    action();
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-30 hidden pointer-coarse:block">
      {/* The centering translate lives on this wrapper so it can't fight the
          pop animation (which animates transform) on the strip below. */}
      <div
        data-ra-float
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={float.style ?? undefined}
      >
        <div
          role="group"
          aria-label={t("navigator.title")}
          {...float.handleProps}
          className={cn(
            "ra-motion-overlay-pop pointer-events-auto flex touch-none items-center gap-0.5 rounded-lg border border-border bg-[var(--ra-main-surface-color)] p-1 shadow-[0_4px_16px_-6px_rgba(28,25,23,0.25)]",
            float.dragging && "shadow-[0_8px_24px_-8px_rgba(28,25,23,0.4)]",
          )}
        >
          <IconButton
            label={t("navigator.prevSentence")}
            title={t("navigator.prevSentence")}
            size="md"
            onClick={step(onPrev)}
            className={stepButtonClass}
            icon={<CaretLeft size={22} weight="regular" aria-hidden="true" />}
          />
          <span aria-hidden="true" className="mx-0.5 h-6 w-px shrink-0 bg-border" />
          <IconButton
            label={t("navigator.nextSentence")}
            title={t("navigator.nextSentence")}
            size="md"
            onClick={step(onNext)}
            className={stepButtonClass}
            icon={<CaretRight size={22} weight="regular" aria-hidden="true" />}
          />
        </div>
      </div>
    </div>
  );
}
