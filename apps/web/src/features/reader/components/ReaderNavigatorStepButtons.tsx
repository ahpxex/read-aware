import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import type { ReactNode, RefObject } from "react";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import { useDraggableFloat } from "../hooks/useDraggableFloat";

type ReaderNavigatorStepButtonsProps = {
  visible: boolean;
  /** Coordinate space the buttons float in (the reader root). */
  containerRef: RefObject<HTMLElement | null>;
  onPrev: () => void;
  onNext: () => void;
};

function StepButton({
  containerRef,
  controlId,
  defaultPosition,
  label,
  icon,
  onStep,
}: {
  containerRef: RefObject<HTMLElement | null>;
  controlId: string;
  defaultPosition: { x: number; y: number };
  label: string;
  icon: ReactNode;
  onStep: () => void;
}) {
  const float = useDraggableFloat({ containerRef, controlId, defaultPosition });

  return (
    <div
      data-ra-float
      className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2"
      style={float.style ?? undefined}
    >
      <button
        type="button"
        aria-label={label}
        title={label}
        {...float.handleProps}
        onClick={() => {
          if (float.consumeDragClick()) return;
          onStep();
        }}
        className={cn(
          "ra-motion-overlay-pop pointer-events-auto flex h-12 w-12 touch-none items-center justify-center rounded-full border border-border bg-[var(--ra-main-surface-color)] text-fg-muted shadow-[0_4px_16px_-6px_rgba(28,25,23,0.35)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg active:bg-fill-strong active:text-fg",
          float.dragging && "scale-105 text-fg shadow-[0_8px_24px_-8px_rgba(28,25,23,0.45)]",
        )}
      >
        {icon}
      </button>
    </div>
  );
}

/**
 * The sentence navigator's floating step controls: one large previous / next
 * button per side, sized for a thumb rather than a pointer. Each floats free —
 * drag it anywhere over the page and the spot sticks (per device, across
 * books). Shown only on coarse-pointer devices; the desktop keeps stepping via
 * the bar and the keyboard.
 */
export function ReaderNavigatorStepButtons({
  visible,
  containerRef,
  onPrev,
  onNext,
}: ReaderNavigatorStepButtonsProps) {
  const { t } = useTranslation("reader");
  if (!visible) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 hidden pointer-coarse:block">
      <StepButton
        containerRef={containerRef}
        controlId="navigator-step-prev"
        defaultPosition={{ x: 0.12, y: 0.62 }}
        label={t("navigator.prevSentence")}
        icon={<CaretLeft size={22} weight="regular" aria-hidden="true" />}
        onStep={onPrev}
      />
      <StepButton
        containerRef={containerRef}
        controlId="navigator-step-next"
        defaultPosition={{ x: 0.88, y: 0.62 }}
        label={t("navigator.nextSentence")}
        icon={<CaretRight size={22} weight="regular" aria-hidden="true" />}
        onStep={onNext}
      />
    </div>
  );
}
