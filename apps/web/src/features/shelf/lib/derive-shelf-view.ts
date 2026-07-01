import type { TFunction } from "i18next";
import type { LibraryBook, ShelfSection } from "../../library/lib/library-types";
import type { ShelfGroup, ShelfSort, ShelfView } from "./shelf-view";

function recentTime(book: LibraryBook): number {
  return new Date(book.lastOpenedAt ?? book.updatedAt).getTime();
}

/** Starred books sort ahead of the rest, then fall back to the chosen order. */
function withStarredFirst(
  next: (a: LibraryBook, b: LibraryBook) => number,
): (a: LibraryBook, b: LibraryBook) => number {
  return (a, b) => Number(Boolean(b.starred)) - Number(Boolean(a.starred)) || next(a, b);
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

const STATUS_ORDER: LibraryBook["readingStatus"][] = ["reading", "unread", "finished"];

function statusLabel(status: LibraryBook["readingStatus"], t: TFunction<"shelf">): string {
  switch (status) {
    case "reading":
      return t("groupSection.reading");
    case "unread":
      return t("groupSection.unread");
    case "finished":
      return t("groupSection.finished");
  }
}

function groupLabel(book: LibraryBook, group: ShelfGroup, t: TFunction<"shelf">): string {
  if (group === "author") return book.author || t("groupSection.unknownAuthor");
  if (group === "format") return book.format.toUpperCase();
  return "";
}

/**
 * Turn the flat book list into the sections to render for the current view.
 * `group: "none"` yields a single unlabeled section (a flat shelf); the other
 * groupings yield labeled sections. Books are sorted before grouping, so order
 * is preserved within each section.
 */
export function deriveShelfView(
  books: LibraryBook[],
  view: ShelfView,
  t: TFunction<"shelf">,
): ShelfSection[] {
  const sorted = [...books].sort(withStarredFirst(comparator(view.sort)));

  if (view.group === "none") {
    return sorted.length ? [{ label: "", books: sorted }] : [];
  }

  if (view.group === "status") {
    return STATUS_ORDER
      .map((key) => ({
        label: statusLabel(key, t),
        books: sorted.filter((book) => book.readingStatus === key),
      }))
      .filter((section) => section.books.length > 0);
  }

  // author / format: bucket in sorted order, then order the groups alphabetically.
  const groups = new Map<string, LibraryBook[]>();
  for (const book of sorted) {
    const label = groupLabel(book, view.group, t);
    const bucket = groups.get(label);
    if (bucket) bucket.push(book);
    else groups.set(label, [book]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, groupBooks]) => ({ label, books: groupBooks }));
}
