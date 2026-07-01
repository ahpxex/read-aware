import { Button, Dialog, Divider } from "@read-aware/ui";
import { Trans, useTranslation } from "../../../i18n";
import type { LibraryBook } from "../../library/lib/library-types";
import { BookStatsPanel } from "../../stats/components/BookStatsPanel";

type BookDetailsDialogProps = {
  book: LibraryBook;
  open: boolean;
  onClose: () => void;
};

/**
 * Book metadata plus detailed reading statistics. Shared by the grid cover and
 * the list row. The metadata list stays minimal; progress, streaks, time
 * dimensions, notes/highlights, and the calendar heatmap live in `BookStatsPanel`.
 */
export function BookDetailsDialog({ book, open, onClose }: BookDetailsDialogProps) {
  const { t } = useTranslation("shelf");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("details.title")}
      className="max-w-xl max-h-[85vh] overflow-y-auto p-6"
    >
      <div className="space-y-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-fg-muted">
          <dt className="font-medium text-fg-muted">{t("details.fieldTitle")}</dt>
          <dd className="truncate">{book.title}</dd>
          <dt className="font-medium text-fg-muted">{t("details.fieldAuthor")}</dt>
          <dd className="truncate">{book.author}</dd>
          <dt className="font-medium text-fg-muted">{t("details.fieldFormat")}</dt>
          <dd className="uppercase">{book.format}</dd>
        </dl>

        <Divider />

        <BookStatsPanel book={book} />

        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("actions.close")}
          </Button>
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
