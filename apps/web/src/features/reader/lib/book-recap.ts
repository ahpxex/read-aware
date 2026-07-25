/**
 * The AI look-back written for a finished book, kept so it is paid for once.
 *
 * Held in the device-local kv store rather than the event log: it is DERIVED
 * from the reader's marks, so a replay could reproduce it — but reproducing it
 * costs a model call, which is exactly what caching it avoids. It is therefore
 * treated like the cover cache: local, rebuildable, never synced.
 *
 * The mark count is stored alongside. Adding or removing marks makes the recap
 * stale — it was written about a different set of passages — so the count is
 * what decides whether a fresh one is due, instead of regenerating on every
 * visit or never again.
 */
import { localKV } from "../../../platform/local-store";

const KEY_PREFIX = "read-aware-book-recap.";

export type BookRecap = {
  text: string;
  /** How many marks the recap was written from. */
  marksCount: number;
  /** ISO timestamp, for a future "written on …" line. */
  writtenAt: string;
};

export function readBookRecap(bookId: string): BookRecap | null {
  const raw = localKV.getItem(KEY_PREFIX + bookId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BookRecap>;
    if (typeof parsed.text !== "string" || !parsed.text) return null;
    return {
      text: parsed.text,
      marksCount: typeof parsed.marksCount === "number" ? parsed.marksCount : 0,
      writtenAt: typeof parsed.writtenAt === "string" ? parsed.writtenAt : "",
    };
  } catch {
    return null;
  }
}

export function saveBookRecap(bookId: string, recap: BookRecap): void {
  localKV.setItem(KEY_PREFIX + bookId, JSON.stringify(recap));
}

/** A stored recap is reusable only if it covers the marks that exist now. */
export function isRecapCurrent(recap: BookRecap | null, marksCount: number): boolean {
  return recap != null && recap.marksCount === marksCount;
}
