import { Alert, Body, Button, EmptyState, TextField } from "../../../components";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { Shelf } from "../../shelf/components/Shelf";
import type { LibraryBook, ShelfSection } from "../lib/library-types";

type LibraryWorkspaceProps = {
  isReady: boolean;
  error: string | null;
  sections: ShelfSection[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onImport: () => void;
  onOpenBook: (book: LibraryBook) => void;
  onRemoveBook: (book: LibraryBook) => void;
};

export function LibraryWorkspace({
  isReady,
  error,
  sections,
  searchQuery,
  onSearchChange,
  onImport,
  onOpenBook,
  onRemoveBook,
}: LibraryWorkspaceProps) {
  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className="ra-motion-page-enter mx-auto max-w-screen-2xl px-6 py-8 sm:py-10">
      {error && (
        <Alert variant="destructive" title="Library error" className="mb-6">
          {error}
        </Alert>
      )}

      {/* Search Bar */}
      <div className="mb-8">
        <TextField
          label="Search"
          type="search"
          placeholder="Search by title or author..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          leadingIcon={<MagnifyingGlass size={16} weight="regular" />}
          className="max-w-md"
        />
      </div>

      {!isReady ? (
        <div className="py-16">
          <Body className="text-sm text-stone-600">Loading your library...</Body>
        </div>
      ) : sections.length === 0 ? (
        <EmptyState
          title={isSearching ? "No books found" : "Import your first book"}
          description={
            isSearching
              ? `No books match "${searchQuery}". Try a different search term.`
              : "ReadAware keeps imported EPUB files locally in your browser, along with your last reading position."
          }
          action={
            !isSearching && (
              <Button size="sm" onClick={onImport}>
                Import EPUB
              </Button>
            )
          }
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
