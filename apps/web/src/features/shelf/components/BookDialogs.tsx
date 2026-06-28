import { Button, Dialog, Divider } from "@read-aware/ui";
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
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Book details"
      className="max-w-xl max-h-[85vh] overflow-y-auto p-6"
    >
      <div className="space-y-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-fg-muted">
          <dt className="font-medium text-fg-muted">Title</dt>
          <dd className="truncate">{book.title}</dd>
          <dt className="font-medium text-fg-muted">Author</dt>
          <dd className="truncate">{book.author}</dd>
          <dt className="font-medium text-fg-muted">Format</dt>
          <dd className="uppercase">{book.format}</dd>
        </dl>

        <Divider />

        <BookStatsPanel book={book} />

        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
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
  return (
    <Dialog open={open} onClose={onClose} title="Remove book?">
      <div className="space-y-4">
        <p>
          Remove <strong>{book.title}</strong> from your library and delete its
          stored file from this device?
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>
            Remove
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
