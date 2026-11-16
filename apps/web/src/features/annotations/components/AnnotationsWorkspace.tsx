/**
 * The highlights & notes page — the container half. It owns the observation,
 * the selected book's contents read, and opening or deleting a mark
 * (`useAnnotationsWorkspace`); the page itself is `AnnotationsWorkspaceView`.
 */
import type { LibraryBook } from "../../library";
import { useAnnotationsWorkspace } from "../hooks/useAnnotationsWorkspace";
import { AnnotationsWorkspaceView } from "./AnnotationsWorkspaceView";

export function AnnotationsWorkspace({ books }: { books: LibraryBook[] }) {
  const state = useAnnotationsWorkspace(books);
  return (
    <AnnotationsWorkspaceView
      books={state.books}
      selectedBookId={state.selectedBookId}
      onSelectBook={state.selectBook}
      isLoading={state.isLoading}
      loadFailed={state.loadFailed}
      loadErrorCode={state.loadErrorCode}
      onRetry={state.retry}
      chapters={state.chapters}
      filter={state.filter}
      onFilterChange={state.setFilter}
      query={state.query}
      onQueryChange={state.setQuery}
      onOpenPassage={state.openPassage}
      onDelete={state.remove}
    />
  );
}
