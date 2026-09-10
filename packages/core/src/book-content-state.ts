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

export type BookContentObservation =
  | { status: "ready"; snapshot: BookContentState }
  | { status: "error"; errorCode: string };
