import { useEffect } from "react";
import { X } from "@phosphor-icons/react";
import { IconButton } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { useAnchoredMenuPosition } from "../hooks/useAnchoredMenuPosition";
import type { SelectionOverlayRect } from "../lib/selection-overlay";

type ReaderFootnotePopoverProps = {
  anchorRect: SelectionOverlayRect | null;
  label: string;
  text: string;
  onClose: () => void;
};

/**
 * A small popover that shows a footnote's text next to the reference that was
 * clicked, instead of jumping to the note's location. Rendered only while a note
 * is open; positioned against the anchor and dismissed on Esc or an outside
 * click.
 */
export function ReaderFootnotePopover({
  anchorRect,
  label,
  text,
  onClose,
}: ReaderFootnotePopoverProps) {
  const { t } = useTranslation("reader");
  const { containerRef, menuRef, position } = useAnchoredMenuPosition(anchorRect);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return (
    <div ref={containerRef} className="absolute inset-0 z-30 overflow-hidden">
      <button
        type="button"
        aria-label={t("dismissNote")}
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        ref={menuRef}
        role="dialog"
        aria-label={label}
        className="absolute flex max-h-[min(45vh,22rem)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-[var(--ra-main-surface-color)] shadow-[0_8px_28px_-8px_rgba(28,25,23,0.32)]"
        style={position}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 py-1 pl-3 pr-1">
          <span className="font-sans text-eyebrow uppercase tracking-wide text-fg-subtle">
            {label}
          </span>
          <IconButton
            label={t("closeNote")}
            size="sm"
            onClick={onClose}
            icon={<X size={14} weight="regular" aria-hidden="true" />}
          />
        </div>
        <div className="min-h-0 overflow-y-auto px-3.5 py-3">
          <p className="font-serif text-[0.9375rem] leading-relaxed text-fg-muted">{text}</p>
        </div>
      </div>
    </div>
  );
}
