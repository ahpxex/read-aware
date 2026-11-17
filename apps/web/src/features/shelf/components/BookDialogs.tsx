import { Button, Dialog } from "@read-aware/ui";
import { Trans, useTranslation } from "../../../i18n";
import { useBookAnnotations } from "../../annotations/hooks/useBookAnnotations";
import type { BookMetadataPatch, LibraryBook } from "../../library/lib/library-types";
import { useBookDetailsMarks } from "../hooks/useBookDetailsMarks";
import { useBookSpoilerProtection } from "../hooks/useBookSpoilerProtection";
import { BookDetailsDialogView } from "./BookDetailsDialogView";

type BookDetailsDialogProps = {
  book: LibraryBook;
  open: boolean;
  onClose: () => void;
  /** When provided, the dialog offers inline editing of title/author. */
  onUpdateMetadata?: (patch: BookMetadataPatch) => void;
};

/**
 * Book details — the container half. It observes the book's highlights and
 * notes while the dialog is open (`useBookDetailsMarks`); the dialog itself is
 * `BookDetailsDialogView`.
 */
export function BookDetailsDialog({ book, open, onClose, onUpdateMetadata }: BookDetailsDialogProps) {
  // Only observe annotations while the dialog is open.
  const observed = useBookAnnotations(open ? book.id : null);
  const marks = useBookDetailsMarks(book.id, open, onClose, observed);
  const spoilerProtection = useBookSpoilerProtection(book);
  return (
    <BookDetailsDialogView
      book={book}
      open={open}
      onClose={onClose}
      onUpdateMetadata={onUpdateMetadata}
      marks={marks}
      spoilerProtection={spoilerProtection}
    />
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
