import type { LibraryBook, ShelfSection } from "../../library/lib/library-types";
import type { ShelfGroup, ShelfSort, ShelfView } from "./shelf-view";

function recentTime(book: LibraryBook): number {
  return new Date(book.lastOpenedAt ?? book.updatedAt).getTime();
}

function comparator(sort: ShelfSort): (a: LibraryBook, b: LibraryBook) => number {
  switch (sort) {
    case "added":
      return (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    case "title":
      return (a, b) => a.title.localeCompare(b.title);
    case "author":
      return (a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title);
    case "progress":
      return (a, b) => b.progressPercent - a.progressPercent;
    case "recent":
    default:
      return (a, b) => recentTime(b) - recentTime(a);
  }
}

const STATUS_ORDER: { key: LibraryBook["readingStatus"]; label: string }[] = [
  { key: "reading", label: "Currently Reading" },
  { key: "unread", label: "Up Next" },
  { key: "finished", label: "Finished" },
];

function groupLabel(book: LibraryBook, group: ShelfGroup): string {
  if (group === "author") return book.author || "Unknown author";
  if (group === "format") return book.format.toUpperCase();
  return "";
}

/**
 * Turn the flat book list into the sections to render for the current view.
 * `group: "none"` yields a single unlabeled section (a flat shelf); the other
 * groupings yield labeled sections. Books are sorted before grouping, so order
 * is preserved within each section.
 */
export function deriveShelfView(books: LibraryBook[], view: ShelfView): ShelfSection[] {
  const sorted = [...books].sort(comparator(view.sort));

  if (view.group === "none") {
    return sorted.length ? [{ label: "", books: sorted }] : [];
  }

  if (view.group === "status") {
    return STATUS_ORDER
      .map(({ key, label }) => ({ label, books: sorted.filter((book) => book.readingStatus === key) }))
      .filter((section) => section.books.length > 0);
  }

  // author / format: bucket in sorted order, then order the groups alphabetically.
  const groups = new Map<string, LibraryBook[]>();
  for (const book of sorted) {
    const label = groupLabel(book, view.group);
    const bucket = groups.get(label);
    if (bucket) bucket.push(book);
    else groups.set(label, [book]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, groupBooks]) => ({ label, books: groupBooks }));
}
