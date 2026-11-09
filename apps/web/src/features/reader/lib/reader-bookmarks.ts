/**
 * Bookmark the open book and go to places in it — the reader's side of the
 * library bookmarks domain (domain/bookmarks.ts). One entry point for the
 * contents panel, the reader shortcut and the search results.
 */
import { AppError, bookmarkTargetFrom, type Bookmark, type ReadingTarget } from "@read-aware/core";
import type { DomainActor } from "../../../platform/domain-actor";
import { readingRuntime } from "../../../domain/reading-runtime";
import { createBookmark } from "../../../domain/bookmarks";
import { createLibraryDomain } from "../../../domain/library";

/**
 * Bookmark where the open book is now. Without a usable `name` (the caller
 * passes the current chapter's title when it knows one) the book's title
 * names it.
 */
export async function bookmarkReadingPosition(name?: string, origin: DomainActor = "user"): Promise<Bookmark> {
  const session = readingRuntime.snapshot();
  if (session.status !== "ready" || !session.bookId || !session.location)
    throw new AppError("reader/no-session", "Open a book before adding a bookmark");
  const location = session.location;
  const fallback = async () =>
    (await createLibraryDomain(origin).queries.books.get(session.bookId!))?.title.trim().slice(0, 120) ||
    session.bookId!;
  return createBookmark(
    {
      bookId: session.bookId,
      name: name?.trim().slice(0, 120) || (await fallback()),
      kind: "location",
      target: bookmarkTargetFrom(location, "location"),
    },
    { origin },
  );
}

/** A jump inside the open book (recorded in its back/forward history). */
export async function goToReadingTarget(target: ReadingTarget, origin: DomainActor = "user"): Promise<void> {
  await readingRuntime.navigate(target, undefined, origin);
}
