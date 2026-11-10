import { ArrowArcLeft, X } from "@phosphor-icons/react";
import { Button, IconButton } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";

/**
 * The way back after a jump: a small floating control over the page, naming
 * the page the reader left when the book has pages to name. Its own close
 * button keeps the reader where they are.
 */
export function ReaderJumpReturn({
  page,
  onBack,
  onDismiss,
}: {
  /** The page the reader left, as the header counts pages; null without one to name. */
  page: number | null;
  onBack: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation("reader");
  return (
    <div
      role="group"
      aria-label={t("jumpReturn.label")}
      className="ra-motion-overlay-pop pointer-events-auto flex max-w-full items-center rounded-md border border-border bg-[var(--ra-main-surface-color)] p-0.5 shadow-[0_4px_16px_-6px_rgba(28,25,23,0.25)]"
    >
      <Button variant="ghost" size="sm" onClick={onBack} className="h-7 min-w-0 rounded px-2 text-caption">
        <ArrowArcLeft size={14} weight="regular" aria-hidden="true" className="shrink-0" />
        <span className="truncate tabular-nums">
          {page === null ? t("jumpReturn.back") : t("jumpReturn.toPage", { page })}
        </span>
      </Button>
      <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-border" />
      <IconButton
        size="sm"
        label={t("jumpReturn.dismiss")}
        onClick={onDismiss}
        className="rounded hover:bg-fg/5"
        icon={<X size={12} weight="regular" aria-hidden="true" />}
      />
    </div>
  );
}
