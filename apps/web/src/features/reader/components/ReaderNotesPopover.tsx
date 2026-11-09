import { useState } from "react";
import { Notebook } from "@phosphor-icons/react";
import { Body, Eyebrow, Popover, InlineError, Spinner } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { formatNumber, useTranslation } from "../../../i18n";
import { describeErrorCode } from "../../../i18n/describe-error";
import { AnnotationRow } from "../../annotations/components/AnnotationRow";
import type { Annotation } from "../../annotations/lib/annotation-types";
import { normalizeHref } from "../lib/epub-utils";
import { ReaderBookmarkSection, type ReaderBookmarks } from "./ReaderBookmarkList";
import type { TocEntry } from "../lib/reader-types";

type ReaderNotesPopoverProps = {
  annotations: Annotation[];
  /** The read failed — render an error state, never "no annotations yet". */
  loadFailed?: boolean;
  loadErrorCode?: string;
  isLoading?: boolean;
  onRetryLoad?: () => void;
  tocEntries: TocEntry[];
  onNavigate: (cfiRange: string) => void;
  onDelete: (id: string) => void;
  /** The book's bookmarks, listed first. */
  bookmarks?: ReaderBookmarks;
  /** 受控开合（导航条的面板意图需要外部打开）；不传则保持自管状态。 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

// Mirrors the header icon buttons so the trigger sits flush with them.
const TRIGGER_CLASS =
  "h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg";

type Group = { label: string | null; items: Annotation[] };

/** Order annotations by their chapter's position in the TOC; anything that
 *  doesn't map to a chapter falls into a trailing unlabeled group. */
function groupByTocOrder(annotations: Annotation[], tocEntries: TocEntry[]): Group[] {
  const groups: Group[] = [];
  const claimed = new Set<string>();
  for (const entry of tocEntries) {
    const key = normalizeHref(entry.href);
    const items = annotations.filter(
      (a) => a.chapterHref && normalizeHref(a.chapterHref) === key && !claimed.has(a.id),
    );
    if (items.length === 0) continue;
    items.forEach((a) => claimed.add(a.id));
    groups.push({ label: entry.label, items });
  }
  const rest = annotations.filter((a) => !claimed.has(a.id));
  if (rest.length > 0) groups.push({ label: null, items: rest });
  return groups;
}

/**
 * The book's highlights and notes, opened from a header icon. Grouped by chapter
 * (in reading order); selecting one navigates to it and closes the popover.
 * Lives in the header so the right-hand panel can stay dedicated to chat.
 */
export function ReaderNotesPopover({
  annotations,
  loadFailed = false,
  loadErrorCode,
  isLoading = false,
  onRetryLoad,
  tocEntries,
  onNavigate,
  onDelete,
  bookmarks,
  open: controlledOpen,
  onOpenChange,
}: ReaderNotesPopoverProps) {
  const { t } = useTranslation(["reader", "common"]);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="left"
      className="pointer-events-auto"
      triggerLabel={t("notes")}
      triggerTooltip={t("notes")}
      triggerClassName={cn(TRIGGER_CLASS, open && "text-fg")}
      trigger={<Notebook size={18} weight={open ? "bold" : "regular"} aria-hidden="true" />}
      panelClassName="flex max-h-[min(28rem,70vh)] w-[clamp(18rem,28vw,26rem)] flex-col overflow-hidden p-0"
    >
      <ReaderNotesContent
        annotations={annotations}
        loadFailed={loadFailed}
        loadErrorCode={loadErrorCode}
        isLoading={isLoading}
        onRetryLoad={onRetryLoad}
        tocEntries={tocEntries}
        onNavigate={(cfiRange) => {
          onNavigate(cfiRange);
          setOpen(false);
        }}
        onDelete={onDelete}
        bookmarks={
          bookmarks && {
            ...bookmarks,
            onOpen: (bookmark) => {
              bookmarks.onOpen(bookmark);
              setOpen(false);
            },
          }
        }
      />
    </Popover>
  );
}

type ReaderNotesContentProps = Pick<
  ReaderNotesPopoverProps,
  | "annotations"
  | "loadFailed"
  | "loadErrorCode"
  | "isLoading"
  | "onRetryLoad"
  | "tocEntries"
  | "onNavigate"
  | "onDelete"
  | "bookmarks"
> & {
  /** Show the "Notes" eyebrow and count; a host with its own title omits it. */
  heading?: boolean;
};

/**
 * The notes list itself, shared by the header popover, the dialog that hosts
 * it when no header trigger does, and the phone bottom bar's drawer.
 */
export function ReaderNotesContent({
  annotations,
  loadFailed = false,
  loadErrorCode,
  isLoading = false,
  onRetryLoad,
  tocEntries,
  onNavigate,
  onDelete,
  bookmarks,
  heading = true,
}: ReaderNotesContentProps) {
  const { t } = useTranslation(["reader", "common"]);
  const groups = groupByTocOrder(annotations, tocEntries);
  const failure = describeErrorCode(loadErrorCode);

  return (
    <>
      {heading && (
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
          <Eyebrow as="span">{t("notes")}</Eyebrow>
          <span className="text-xs tabular-nums text-fg-subtle">
            {loadFailed || isLoading ? null : formatNumber(annotations.length)}
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div data-swipe-reveal-scope className="flex flex-col gap-3 px-3 pb-3">
          {bookmarks && <ReaderBookmarkSection {...bookmarks} />}
          {loadFailed ? (
            <div className="px-1 py-3">
              <InlineError
                onRetry={failure?.retryable ? onRetryLoad : undefined}
                retryLabel={t("common:errorBoundary.retry")}
              >
                {failure?.body ?? t("common:errors.generic")}
              </InlineError>
            </div>
          ) : isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner size="sm" />
            </div>
          ) : annotations.length === 0 ? (
            <Body className="px-1 py-6 text-center text-sm text-fg-muted">{t("emptyNotes")}</Body>
          ) : (
            groups.map((group, index) => (
              <div key={group.label ?? `__rest__${index}`}>
                {/* Pinned while its chapter's notes scroll past. It needs the
                    host's surface color to cover them: a host other than a
                    popover sets --ra-panel-surface. */}
                {group.label && (
                  <p className="sticky top-0 z-[1] bg-[var(--ra-panel-surface,var(--ra-main-surface-color))] px-2 py-1.5 font-sans text-xs font-medium text-fg-subtle">
                    {group.label}
                  </p>
                )}
                <div className="flex flex-col gap-1">
                  {group.items.map((annotation) => (
                    <AnnotationRow
                      key={annotation.id}
                      annotation={annotation}
                      onNavigate={onNavigate}
                      onDelete={onDelete}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
