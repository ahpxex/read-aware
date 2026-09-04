import { customSchemeUrl } from "../../../platform/custom-scheme";
import type { LibraryBook, LibraryBookRow } from "./library-types";

/**
 * The URL a shelf tile paints for a book's cover, or null while there is
 * nothing to paint (no cover, or its bytes have not reached this device).
 *
 * `rablob://localhost/cover/<id>` is served by the Rust shell straight from
 * the blob store, so no image bytes ever ride through IPC or the shelf's
 * JSON payload. The `v` query carries the cover's content hash: the shell
 * answers with an immutable cache policy, and a re-extracted cover gets a
 * new URL rather than a stale hit.
 */
export function bookCoverUrl(
  book: Pick<LibraryBookRow, "id" | "coverStatus" | "coverLocal" | "coverVersion">,
): string | null {
  if (book.coverStatus !== "ready" || !book.coverLocal) return null;
  const version = book.coverVersion ? `?v=${encodeURIComponent(book.coverVersion)}` : "";
  return customSchemeUrl("rablob", `cover/${encodeURIComponent(book.id)}${version}`);
}

/** Lift a projection row into the shelf model (adds the derived cover URL). */
export function withCoverUrl(row: LibraryBookRow): LibraryBook {
  return { ...row, coverUrl: bookCoverUrl(row) };
}
