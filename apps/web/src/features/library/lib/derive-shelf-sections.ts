import type { LibraryBook, ShelfSection } from "./library-types";

function sortByRecent(left: LibraryBook, right: LibraryBook) {
  const leftTime = new Date(left.lastOpenedAt ?? left.updatedAt).getTime();
  const rightTime = new Date(right.lastOpenedAt ?? right.updatedAt).getTime();
  return rightTime - leftTime;
}

function sortByCreated(left: LibraryBook, right: LibraryBook) {
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
}

export function deriveShelfSections(books: LibraryBook[]): ShelfSection[] {
  const currentlyReading = books
    .filter((book) => book.readingStatus === "reading")
    .sort(sortByRecent);
  const upNext = books
    .filter((book) => book.readingStatus === "unread")
    .sort(sortByCreated);
  const finished = books
    .filter((book) => book.readingStatus === "finished")
    .sort(sortByRecent);

  return [
    { label: "Currently Reading", books: currentlyReading },
    { label: "Up Next", books: upNext },
    { label: "Finished", books: finished },
  ].filter((section) => section.books.length > 0);
}
