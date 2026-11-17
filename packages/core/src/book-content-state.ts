/** Source metadata only: querying this never parses, downloads or invokes a provider. */
export type BookContentState = {
  bookId: string;
  source: "file" | "virtual";
  availability: "local" | "missing" | "provider-registered" | "provider-unavailable";
  /** Opaque process-local equality token. Compare with a ready reading session's
   * sourceRevision; this is neither a durable locator nor a write/CAS token. */
  sourceRevision: string;
  /** Local file hash when known; virtual content is not loaded just to hash it. */
  contentVersion: string | null;
};

/**
 * Whether a book can be opened on this device right now, as far as its file
 * goes. `on-device` and `retrievable` open (the second after a download);
 * `unretrievable` does not, and `reason` says why with the reader's own
 * missing-file vocabulary; `unknown` could not be established this time.
 */
export type BookFileAvailability =
  | { state: "on-device" }
  | { state: "retrievable" }
  | { state: "unretrievable"; reason: "no-sync" | "not-on-relay" }
  | { state: "unknown"; reason: "unauthenticated" | "unreachable" | "unverifiable" }
  /** A plugin-provided book has no file; its provider decides whether it opens. */
  | { state: "virtual" };

export type BookFileCheck = { bookId: string; title: string; file: BookFileAvailability };

/** `remaining` counts not-on-device books an unnamed check left for a later call. */
export type BookFileCheckResult = { checks: BookFileCheck[]; remaining: number };

/** Books one check may name; a larger shelf is checked in several calls. */
export const MAX_BOOK_FILE_CHECK = 200;

export type BookContentObservation =
  | { status: "ready"; snapshot: BookContentState }
  | { status: "error"; errorCode: string };
