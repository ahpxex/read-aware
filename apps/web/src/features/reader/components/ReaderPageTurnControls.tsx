import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { IconButton } from "@read-aware/ui";

type ReaderPageTurnControlsProps = {
  /** Shown only in paginated layouts; scroll mode turns by scrolling. */
  visible: boolean;
  onPrev: () => void;
  onNext: () => void;
};

/**
 * Explicit page-turn affordances pinned to the reader's left and right edges.
 * Tapping book content no longer turns the page — a stray click while reading
 * shouldn't cost you your place — so in paginated modes these buttons (and the
 * keyboard shortcuts) are how the mouse turns pages. Each button lives inside a
 * non-interactive edge strip, so the surrounding gutter still falls through to
 * the shell toggle underneath.
 */
export function ReaderPageTurnControls({
  visible,
  onPrev,
  onNext,
}: ReaderPageTurnControlsProps) {
  if (!visible) return null;

  const buttonClassName =
    "pointer-events-auto h-11 w-11 text-fg-subtle opacity-70 transition-opacity hover:text-fg hover:opacity-100";

  return (
    <>
      <div className="pointer-events-none absolute inset-y-0 left-0 z-30 flex items-center pl-1 sm:pl-3">
        <IconButton
          size="md"
          label="Previous page"
          onClick={onPrev}
          className={buttonClassName}
          icon={<CaretLeft size={24} weight="regular" aria-hidden="true" />}
        />
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 z-30 flex items-center pr-1 sm:pr-3">
        <IconButton
          size="md"
          label="Next page"
          onClick={onNext}
          className={buttonClassName}
          icon={<CaretRight size={24} weight="regular" aria-hidden="true" />}
        />
      </div>
    </>
  );
}
