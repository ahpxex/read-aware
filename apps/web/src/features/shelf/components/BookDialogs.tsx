import { Button, Dialog } from "@read-aware/ui";
import type { LibraryBook } from "../../library/lib/library-types";

function formatLastOpenedAt(lastOpenedAt: string | null) {
  if (!lastOpenedAt) return "Not opened yet";

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(lastOpenedAt));
  } catch {
    return lastOpenedAt;
  }
}

type BookDetailsDialogProps = {
  book: LibraryBook;
  open: boolean;
  onClose: () => void;
};

/** Read-only metadata for a book. Shared by the grid cover and the list row. */
export function BookDetailsDialog({ book, open, onClose }: BookDetailsDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Book details">
      <div className="space-y-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-stone-700">
          <dt className="font-medium text-stone-600">Title</dt>
          <dd>{book.title}</dd>
          <dt className="font-medium text-stone-600">Author</dt>
          <dd>{book.author}</dd>
          <dt className="font-medium text-stone-600">Format</dt>
          <dd className="uppercase">{book.format}</dd>
          <dt className="font-medium text-stone-600">File</dt>
          <dd>{book.fileName}</dd>
          <dt className="font-medium text-stone-600">Progress</dt>
          <dd>{book.progressPercent > 0 ? `${Math.round(book.progressPercent)}%` : "Not started"}</dd>
          <dt className="font-medium text-stone-600">Last opened</dt>
          <dd>{formatLastOpenedAt(book.lastOpenedAt)}</dd>
        </dl>
        <div className="flex justify-end">
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
