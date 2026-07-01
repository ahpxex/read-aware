import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { Button, Dialog, TextField } from "@read-aware/ui";
import { Trans, useTranslation } from "../../../i18n";
import { readingStatsAtom } from "../../../state/ui";
import { formatReadingDuration, getBookReadingStats } from "../../reader/lib/reading-stats";
import type { BookMetadataPatch, LibraryBook } from "../../library/lib/library-types";

type BookDetailsDialogProps = {
  book: LibraryBook;
  open: boolean;
  onClose: () => void;
  /** When provided, the dialog offers inline editing of title/author. */
  onUpdateMetadata?: (patch: BookMetadataPatch) => void;
};

/**
 * Book metadata with inline editing (for correcting auto-detected title/author)
 * and total reading time, all as a single metadata list. The exhaustive reading
 * breakdown lives on the Stats page, not here.
 */
export function BookDetailsDialog({ book, open, onClose, onUpdateMetadata }: BookDetailsDialogProps) {
  const { t } = useTranslation("shelf");
  const store = useAtomValue(readingStatsAtom);
  const readingTime = formatReadingDuration(getBookReadingStats(store, book.id).totalMs);

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
    <Dialog open={open} onClose={onClose} title={t("details.title")} className="max-w-md p-6">
      <div className="space-y-4">
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
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-fg-muted">
            <dt className="font-medium text-fg-muted">{t("details.fieldTitle")}</dt>
            <dd className="truncate">{book.title}</dd>
            <dt className="font-medium text-fg-muted">{t("details.fieldAuthor")}</dt>
            <dd className="truncate">{book.author}</dd>
          </dl>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-fg-muted">
          <dt className="font-medium text-fg-muted">{t("details.fieldFormat")}</dt>
          <dd className="uppercase">{book.format}</dd>
          <dt className="font-medium text-fg-muted">{t("details.fieldReading")}</dt>
          <dd className="tabular-nums">{readingTime}</dd>
        </dl>

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
