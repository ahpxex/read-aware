import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { NotePencil } from "@phosphor-icons/react";
import { Body, Button, Caption, Dialog, Progress, TextField } from "@read-aware/ui";
import { Trans, formatPercent, useTranslation } from "../../../i18n";
import { readingStatsAtom } from "../../../state/ui";
import { formatReadingDuration, getBookReadingStats } from "../../reader/lib/reading-stats";
import { useBookAnnotations } from "../../annotations/hooks/useBookAnnotations";
import { HIGHLIGHT_COLORS } from "../../reader/lib/highlight-renderer";
import type { Annotation, Highlight, Note } from "../../annotations/lib/annotation-types";
import type { BookMetadataPatch, LibraryBook } from "../../library/lib/library-types";
import { BookCoverPlaceholder } from "./BookCoverPlaceholder";

type BookDetailsDialogProps = {
  book: LibraryBook;
  open: boolean;
  onClose: () => void;
  /** When provided, the dialog offers inline editing of title/author. */
  onUpdateMetadata?: (patch: BookMetadataPatch) => void;
};

/** One highlight/note in the details preview: its mark, the quoted passage, and any note body. */
function AnnotationPreview({ annotation }: { annotation: Annotation }) {
  return (
    <div className="flex items-start gap-2 px-1 py-1.5">
      {annotation.type === "highlight" ? (
        <span
          className="mt-1 block h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{
            backgroundColor:
              HIGHLIGHT_COLORS[(annotation as Highlight).color] ?? HIGHLIGHT_COLORS.yellow,
          }}
          aria-hidden="true"
        />
      ) : (
        <NotePencil size={13} weight="regular" className="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-xs leading-relaxed text-fg-muted">
          &ldquo;{annotation.text}&rdquo;
        </p>
        {annotation.type === "note" && (annotation as Note).content && (
          <p className="mt-0.5 line-clamp-2 text-xs text-fg">{(annotation as Note).content}</p>
        )}
      </div>
    </div>
  );
}

/** A single labelled figure in the stat strip. */
function DetailStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <Caption className="block text-fg-subtle">{label}</Caption>
      <Body className="truncate text-sm font-medium tabular-nums text-fg">{value}</Body>
    </div>
  );
}

/**
 * Book details: cover, identity (with inline title/author editing for correcting
 * auto-detected metadata), reading progress, headline figures, and a preview of
 * the book's highlights and notes. The exhaustive breakdown lives on the Stats page.
 */
export function BookDetailsDialog({ book, open, onClose, onUpdateMetadata }: BookDetailsDialogProps) {
  const { t } = useTranslation("shelf");
  const store = useAtomValue(readingStatsAtom);
  const readingTime = formatReadingDuration(getBookReadingStats(store, book.id).totalMs);
  // Only read annotations while the dialog is open.
  const { annotations } = useBookAnnotations(open ? book.id : null);
  const highlightCount = annotations.filter((a) => a.type === "highlight").length;
  const noteCount = annotations.filter((a) => a.type === "note").length;

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);

  // Reset the form whenever the dialog (re)opens or the book changes, so a
  // cancelled edit or a different book never leaks stale field values.
  useEffect(() => {
    if (open) {
      setEditing(false);
      setTitle(book.title);
      setAuthor(book.author);
    }
  }, [open, book.id, book.title, book.author]);

  function handleSave() {
    onUpdateMetadata?.({ title, author });
    setEditing(false);
  }

  function handleCancel() {
    setTitle(book.title);
    setAuthor(book.author);
    setEditing(false);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("details.title")}
      className="max-w-lg max-h-[85vh] overflow-y-auto p-6"
    >
      <div className="space-y-5">
        {/* Cover + identity (editable) */}
        <div className="flex gap-4">
          <div className="relative aspect-[2/3] w-24 shrink-0 overflow-hidden rounded-sm shadow-md">
            {book.coverUrl ? (
              <img src={book.coverUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <BookCoverPlaceholder title={book.title} author={book.author} format={book.format} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="space-y-3">
                <TextField
                  label={t("details.fieldTitle")}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <TextField
                  label={t("details.fieldAuthor")}
                  value={author}
                  onChange={(event) => setAuthor(event.target.value)}
                />
              </div>
            ) : (
              <>
                <Body as="h3" className="break-words font-serif text-lg font-medium leading-snug text-fg">
                  {book.title}
                </Body>
                <Body className="mt-1 break-words text-sm text-fg-muted">{book.author}</Body>
                <Caption className="mt-2 block uppercase tracking-wide text-fg-subtle">
                  {book.format}
                </Caption>
              </>
            )}
          </div>
        </div>

        {/* Reading progress */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Caption className="text-fg-subtle">{t("details.progress")}</Caption>
            <Caption className="tabular-nums text-fg-muted">
              {book.progressPercent > 0 ? formatPercent(book.progressPercent) : t("status.notStarted")}
            </Caption>
          </div>
          <Progress value={book.progressPercent} size="sm" />
        </div>

        {/* Headline figures */}
        <div className="grid grid-cols-3 gap-3 border-t border-border pt-4">
          <DetailStat label={t("details.fieldReading")} value={readingTime} />
          <DetailStat label={t("details.highlights")} value={highlightCount} />
          <DetailStat label={t("details.notes")} value={noteCount} />
        </div>

        {/* Highlights & notes preview */}
        {annotations.length > 0 && (
          <div className="border-t border-border pt-4">
            <Caption className="mb-1.5 block text-fg-subtle">{t("details.annotations")}</Caption>
            <div className="-mx-1 max-h-40 space-y-0.5 overflow-y-auto">
              {annotations.slice(0, 20).map((annotation) => (
                <AnnotationPreview key={annotation.id} annotation={annotation} />
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          {editing ? (
            <>
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                {t("actions.cancel")}
              </Button>
              <Button variant="solid" size="sm" onClick={handleSave}>
                {t("details.save")}
              </Button>
            </>
          ) : (
            <>
              {onUpdateMetadata && (
                <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                  {t("details.edit")}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onClose}>
                {t("actions.close")}
              </Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

type BookRemoveDialogProps = {
  book: LibraryBook;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

/** Remove-from-library confirmation. Shared by the grid cover and the list row. */
export function BookRemoveDialog({ book, open, onClose, onConfirm }: BookRemoveDialogProps) {
  const { t } = useTranslation("shelf");
  return (
    <Dialog open={open} onClose={onClose} title={t("removeBook.title")}>
      <div className="space-y-4">
        <p>
          <Trans
            ns="shelf"
            i18nKey="removeBook.body"
            values={{ title: book.title }}
            components={{ strong: <strong /> }}
          />
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("actions.cancel")}
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>
            {t("actions.remove")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

type BooksRemoveDialogProps = {
  count: number;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

/** Bulk remove-from-library confirmation for the batch selection toolbar. */
export function BooksRemoveDialog({ count, open, onClose, onConfirm }: BooksRemoveDialogProps) {
  const { t } = useTranslation("shelf");
  return (
    <Dialog open={open} onClose={onClose} title={t("removeBooks.title", { count })}>
      <div className="space-y-4">
        <p>{t("removeBooks.body", { count })}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("actions.cancel")}
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>
            {t("actions.remove")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
