import { useAtomValue } from "jotai";
import { Alert, Body, Button, EmptyState } from "@read-aware/ui";
import { Shelf } from "../../shelf/components/Shelf";
import { deriveShelfView } from "../../shelf/lib/derive-shelf-view";
import { shelfViewAtom } from "../../../state/ui";
import type { LibraryBook } from "../lib/library-types";

type LibraryWorkspaceProps = {
  isReady: boolean;
  error: string | null;
  books: LibraryBook[];
  onImport: () => void;
  onOpenBook: (book: LibraryBook) => void;
  onRemoveBook: (book: LibraryBook) => void;
};

export function LibraryWorkspace({
  isReady,
  error,
  books,
  onImport,
  onOpenBook,
  onRemoveBook,
}: LibraryWorkspaceProps) {
  const shelfView = useAtomValue(shelfViewAtom);
  const sections = deriveShelfView(books, shelfView);

  return (
    <div className="ra-motion-page-enter mx-auto max-w-screen-2xl px-6 pb-8 pt-5 sm:pb-10 sm:pt-6">
      {error && (
        <Alert variant="destructive" title="Library error" className="mb-6">
          {error}
        </Alert>
      )}

      {!isReady ? (
        <div className="py-16">
          <Body className="text-sm text-stone-600">Loading your library...</Body>
        </div>
      ) : books.length === 0 ? (
        <EmptyState
          title="Import your first book"
          description="ReadAware keeps imported books on this device, along with your last reading position."
          action={(
            <Button size="sm" onClick={onImport}>
              Import a book
            </Button>
          )}
        />
      ) : (
        <Shelf
          sections={sections}
          layout={shelfView.layout}
          onSelect={onOpenBook}
          onRemove={onRemoveBook}
        />
      )}
    </div>
  );
}
