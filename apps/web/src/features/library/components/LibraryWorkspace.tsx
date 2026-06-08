import { Alert, Body, Button, EmptyState } from "../../../components";
import { Shelf } from "../../shelf/components/Shelf";
import type { LibraryBook, ShelfSection } from "../lib/library-types";

type LibraryWorkspaceProps = {
  isReady: boolean;
  error: string | null;
  sections: ShelfSection[];
  onImport: () => void;
  onOpenBook: (book: LibraryBook) => void;
  onRemoveBook: (book: LibraryBook) => void;
};

export function LibraryWorkspace({
  isReady,
  error,
  sections,
  onImport,
  onOpenBook,
  onRemoveBook,
}: LibraryWorkspaceProps) {
  return (
    <div className="ra-motion-page-enter mx-auto max-w-screen-2xl px-6 py-8 sm:py-10">
      {error && (
        <Alert variant="destructive" title="Library error" className="mb-6">
          {error}
        </Alert>
      )}

      {!isReady ? (
        <div className="py-16">
          <Body className="text-sm text-stone-600">Loading your library...</Body>
        </div>
      ) : sections.length === 0 ? (
        <EmptyState
          title="Import your first book"
          description="ReadAware keeps imported EPUB files locally in your browser, along with your last reading position."
          action={(
            <Button size="sm" onClick={onImport}>
              Import EPUB
            </Button>
          )}
        />
      ) : (
        <Shelf
          sections={sections}
          onSelect={onOpenBook}
          onRemove={onRemoveBook}
        />
      )}
    </div>
  );
}
