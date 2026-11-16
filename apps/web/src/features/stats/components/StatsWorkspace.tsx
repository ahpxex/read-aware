/**
 * The stats page — the container half. It owns the annotation-count load
 * (`useAnnotationCounts`); the page itself is `StatsWorkspaceView`.
 */
import type { LibraryBook } from "../../library/lib/library-types";
import { useAnnotationCounts } from "../hooks/useAnnotationCounts";
import { StatsWorkspaceView } from "./StatsWorkspaceView";

export function StatsWorkspace({
  books,
  onOpenBook,
}: {
  books: LibraryBook[];
  onOpenBook: (book: LibraryBook) => void;
}) {
  const annotations = useAnnotationCounts();
  return <StatsWorkspaceView books={books} annotations={annotations} onOpenBook={onOpenBook} />;
}
