import type { TFunction } from "i18next";
import type { Collection, LibraryBook, ShelfEntry, ShelfSection } from "../../library/lib/library-types";
import type { ShelfGroup, ShelfSort, ShelfView } from "./shelf-view";

/** A collection with its member books, as the shelf orders it among the books. */
export type ShelfCollection = { collection: Collection; members: LibraryBook[] };

type Entry = ShelfEntry;

function recentTime(book: LibraryBook): number {
  return new Date(book.lastOpenedAt ?? book.updatedAt).getTime();
}

// A collection takes its place from what is inside it: it was read when its
// most recently read member was, and is as far along as its furthest member.
// It has no author, so it files under its own name; it was added when it was
// made. An empty collection falls back to when it was made, with no progress.
function entryRecent(entry: Entry): number {
  if (entry.kind === "book") return recentTime(entry.book);
  return entry.members.length > 0
    ? Math.max(...entry.members.map(recentTime))
    : new Date(entry.collection.createdAt).getTime();
}
const entryAdded = (entry: Entry) =>
  new Date(entry.kind === "book" ? entry.book.createdAt : entry.collection.createdAt).getTime();
const entryTitle = (entry: Entry) => (entry.kind === "book" ? entry.book.title : entry.collection.name);
const entryAuthor = (entry: Entry) => (entry.kind === "book" ? entry.book.author : entry.collection.name);
const entryProgress = (entry: Entry) =>
  entry.kind === "book"
    ? entry.book.progressPercent
    : Math.max(0, ...entry.members.map((book) => book.progressPercent));
const entryStarred = (entry: Entry) => entry.kind === "book" && Boolean(entry.book.starred);

/** Starred books sort ahead of the rest, then fall back to the chosen order. */
function withStarredFirst(next: (a: Entry, b: Entry) => number): (a: Entry, b: Entry) => number {
  return (a, b) => Number(entryStarred(b)) - Number(entryStarred(a)) || next(a, b);
}

function comparator(sort: ShelfSort): (a: Entry, b: Entry) => number {
  switch (sort) {
    case "added":
      return (a, b) => entryAdded(b) - entryAdded(a);
    case "title":
      return (a, b) => entryTitle(a).localeCompare(entryTitle(b));
    case "author":
      return (a, b) => entryAuthor(a).localeCompare(entryAuthor(b)) || entryTitle(a).localeCompare(entryTitle(b));
    case "progress":
      return (a, b) => entryProgress(b) - entryProgress(a);
    case "recent":
    default:
      return (a, b) => entryRecent(b) - entryRecent(a);
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
 * Turn the books and collections into the sections to render for the current
 * view. `group: "none"` yields a single unlabeled section (a flat shelf) where
 * collections stand among the books in the chosen order. A grouping sorts
 * books by status, author or format; a collection has none of these, so the
 * collections lead in a section of their own. Entries are sorted before
 * grouping, so order is preserved within each section.
 */
export function deriveShelfView(
  books: LibraryBook[],
  collections: ShelfCollection[],
  view: ShelfView,
  t: TFunction<"shelf">,
): ShelfSection[] {
  const order = withStarredFirst(comparator(view.sort));
  const byOrder = (a: LibraryBook, b: LibraryBook) => order({ kind: "book", book: a }, { kind: "book", book: b });
  // Members follow the shelf's order too, so the stack's front cover is the
  // member this view would show first.
  const collectionEntries: Entry[] = collections.map(({ collection, members }) => ({
    kind: "collection",
    collection,
    members: [...members].sort(byOrder),
  }));

  if (view.group === "none") {
    const entries = [...collectionEntries, ...books.map((book): Entry => ({ kind: "book", book }))].sort(order);
    return entries.length ? [{ label: "", entries }] : [];
  }

  const sorted = [...books].sort(byOrder);
  const asEntry = (book: LibraryBook): Entry => ({ kind: "book", book });
  const lead: ShelfSection[] = collectionEntries.length
    ? [{ label: t("groupSection.collections"), entries: [...collectionEntries].sort(order) }]
    : [];

  if (view.group === "status") {
    return [
      ...lead,
      ...STATUS_ORDER.map((key) => ({
        label: statusLabel(key, t),
        entries: sorted.filter((book) => book.readingStatus === key).map(asEntry),
      })).filter((section) => section.entries.length > 0),
    ];
  }

  // author / format: bucket in sorted order, then order the groups alphabetically.
  const groups = new Map<string, Entry[]>();
  for (const book of sorted) {
    const label = groupLabel(book, view.group, t);
    const bucket = groups.get(label);
    if (bucket) bucket.push(asEntry(book));
    else groups.set(label, [asEntry(book)]);
  }

  return [
    ...lead,
    ...[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, entries]) => ({ label, entries })),
  ];
}
