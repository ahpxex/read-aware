export type BookEnrichmentJob = {
  phase: "idle" | "queued" | "running" | "completed" | "skipped" | "failed";
  startedAt: number | null;
  finishedAt: number | null;
  errorCode: string | null;
  reason: "book-removed" | "not-needed" | "unsupported-format" | "source-unavailable" | null;
};
export type BookEnrichmentSnapshot = {
  bookId: string;
  cover: { status: "unchecked" | "none" | "ready"; local: boolean };
  metadataPending: boolean;
  supported: boolean;
  sourceLocal: boolean;
  job: BookEnrichmentJob;
};
export type BookEnrichmentReceipt = {
  status: "queued" | "already-running" | "not-needed" | "unavailable";
  snapshot: BookEnrichmentSnapshot;
};
export type BookEnrichmentObservation =
  | { status: "ready"; snapshot: BookEnrichmentSnapshot }
  | { status: "error"; errorCode: string };
