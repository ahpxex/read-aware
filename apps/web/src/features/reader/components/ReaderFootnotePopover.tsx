import { useEffect } from "react";
import { createPortal } from "react-dom";
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
  /** Explicit API previews sit above the plugin surface that requested them. */
  foreground?: boolean;
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
  foreground = false,
}: ReaderFootnotePopoverProps) {
  const { t } = useTranslation("reader");
  const { containerRef, menuRef, position } = useAnchoredMenuPosition(anchorRect);

  useEffect(() => {
    if (!foreground) return;
    const previous = document.activeElement;
    const menu = menuRef.current;
    menu?.focus();
    return () => {
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        (document.activeElement === document.body || menu?.contains(document.activeElement))
      )
        previous.focus();
    };
  }, [foreground, menuRef]);

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

  const content = (
    <div
      ref={containerRef}
      data-ui-portal={foreground || undefined}
      className={foreground ? "fixed inset-0 z-[90] overflow-hidden" : "absolute inset-0 z-30 overflow-hidden"}
    >
      {/* oxlint-disable-next-line react/forbid-elements -- full-bleed dismiss scrim behind the footnote popover */}
      <button
        type="button"
        aria-label={t("dismissNote")}
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        ref={menuRef}
        role="dialog"
        tabIndex={foreground ? -1 : undefined}
        aria-label={label}
        className="absolute flex max-h-[min(45vh,22rem)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-[var(--ra-main-surface-color)] shadow-[0_8px_28px_-8px_rgba(28,25,23,0.32)]"
        style={position}
      >
        <div className="min-h-0 overflow-y-auto py-3 pl-3.5 pr-9">
          <p className="font-serif text-[0.9375rem] leading-relaxed text-fg-muted">{text}</p>
        </div>
        {/* Outside the scroller so it stays put while a long note scrolls. */}
        <IconButton
          label={t("closeNote")}
          size="sm"
          onClick={onClose}
          className="absolute right-1 top-1.5"
          icon={<X size={14} weight="regular" aria-hidden="true" />}
        />
      </div>
    </div>
  );
  return foreground ? createPortal(content, document.body) : content;
}
