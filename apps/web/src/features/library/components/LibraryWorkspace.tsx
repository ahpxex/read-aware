import { useAtomValue } from "jotai";
import { Books } from "@phosphor-icons/react";
import { Alert, Body, Button, EmptyState } from "@read-aware/ui";
import { Shelf } from "../../shelf/components/Shelf";
import { deriveShelfView } from "../../shelf/lib/derive-shelf-view";
import { shelfViewAtom } from "../../../state/ui";
import type { LibraryBook } from "../lib/library-types";

type LibraryWorkspaceProps = {
  isReady: boolean;
  error: string | null;
  notice?: string | null;
  books: LibraryBook[];
  onImport: () => void;
  onOpenBook: (book: LibraryBook) => void;
  onRemoveBook: (book: LibraryBook) => void;
};

export function LibraryWorkspace({
  isReady,
  error,
  notice,
  books,
  onImport,
  onOpenBook,
  onRemoveBook,
}: LibraryWorkspaceProps) {
  const shelfView = useAtomValue(shelfViewAtom);
  const sections = deriveShelfView(books, shelfView);

  return (
    <div className="ra-motion-page-enter mx-auto flex min-h-full max-w-screen-2xl flex-col px-6 pb-8 pt-5 sm:pb-10 sm:pt-6">
      {error && (
        <Alert variant="destructive" title="Library error" className="mb-6">
          {error}
        </Alert>
      )}

      {notice && (
        <Alert variant="default" title="Import" className="mb-6">
          {notice}
        </Alert>
      )}

      {!isReady ? (
        <div className="flex flex-1 items-center justify-center py-16">
          <Body className="text-sm text-fg-muted">Loading your library...</Body>
        </div>
      ) : books.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-16">
          <EmptyState
            icon={<Books className="size-12 text-fg-subtle" weight="thin" />}
            title="Import your first book"
            action={(
              <Button size="sm" onClick={onImport}>
                Import
              </Button>
            )}
          />
        </div>
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
