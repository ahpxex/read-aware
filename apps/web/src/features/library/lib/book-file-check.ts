import {
  AppError,
  MAX_BOOK_FILE_CHECK,
  type BookFileAvailability,
  type BookFileCheck,
  type BookFileCheckResult,
} from "@read-aware/core";
import { bookFileKey, listLibraryBooks } from "./library-db";
import type { LibraryBook } from "./library-types";
import { isTauri } from "../../../platform/environment";
import { probeRemoteBlobs, type RemoteBlobPresence } from "../../../platform/sync/sync-scheduler";

type Dependencies = {
  list: () => Promise<LibraryBook[]>;
  probe: (keys: readonly string[], signal?: AbortSignal) => Promise<RemoteBlobPresence>;
};

/** What the sync backend's answer means for one book whose file is not on this device. */
function remoteAvailability(presence: RemoteBlobPresence, key: string): BookFileAvailability {
  // Nobody was asked: turning sync on, or signing in again, may still bring the file back.
  if (presence.outcome === "unavailable")
    return { state: "unknown", reason: presence.reason === "not-connected" ? "not-connected" : "no-sync" };
  if (presence.outcome === "unknown")
    return {
      state: "unknown",
      reason:
        presence.reason === "unauthenticated"
          ? "unauthenticated"
          : presence.reason === "unsupported"
            ? "unverifiable"
            : "unreachable",
    };
  return presence.held[key] ? { state: "retrievable" } : { state: "unretrievable", reason: "not-on-relay" };
}

/**
 * Whether each book can be opened here: its file is on this device, sync can
 * still fetch it, or nothing is left to fetch. With no ids, checks the books
 * whose file is not on this device. Asks the sync backend without downloading.
 */
export async function checkBookFiles(
  bookIds?: readonly string[],
  signal?: AbortSignal,
  deps: Dependencies = { list: listLibraryBooks, probe: probeRemoteBlobs },
): Promise<BookFileCheckResult> {
  signal?.throwIfAborted();
  if (!isTauri()) throw new AppError("ui/unavailable", "Book files are checked in the desktop app");
  if (bookIds && (bookIds.length === 0 || bookIds.length > MAX_BOOK_FILE_CHECK))
    throw new AppError("ui/invalid-target", `Name between 1 and ${MAX_BOOK_FILE_CHECK} books`);
  const books = await deps.list();
  signal?.throwIfAborted();
  let targets: LibraryBook[];
  let remaining = 0;
  if (bookIds) {
    const byId = new Map(books.map((book) => [book.id, book]));
    const unknown = [...new Set(bookIds)].filter((id) => !byId.has(id));
    if (unknown.length) throw new AppError("library/book-not-found", `Unknown book IDs: ${unknown.join(", ")}`);
    targets = [...new Set(bookIds)].map((id) => byId.get(id)!);
  } else {
    const absent = books
      .filter((book) => book.format !== "virtual" && !book.fileLocal)
      .sort((a, b) => a.id.localeCompare(b.id));
    targets = absent.slice(0, MAX_BOOK_FILE_CHECK);
    remaining = absent.length - targets.length;
  }
  const absentKeys = targets
    .filter((book) => book.format !== "virtual" && !book.fileLocal)
    .map((book) => bookFileKey(book.id));
  const presence = absentKeys.length ? await deps.probe(absentKeys, signal) : undefined;
  signal?.throwIfAborted();
  const checks: BookFileCheck[] = targets.map((book) => ({
    bookId: book.id,
    title: book.title,
    file:
      book.format === "virtual"
        ? { state: "virtual" }
        : book.fileLocal
          ? { state: "on-device" }
          : remoteAvailability(presence!, bookFileKey(book.id)),
  }));
  return { checks, remaining };
}
