import { AppError, normalizeBookClassification, validateClassificationBookId,
  type BookClassificationChange, type BookClassificationReceipt, type BookClassificationSnapshot, type DigestFlavor, type EventOrigin } from "@read-aware/core";
import { invoke } from "../platform/ipc";
import { isTauri } from "../platform/environment";
import { broadcastDomainEventDrafts, mintEventRows, type DomainEventDraft } from "../platform/domain-events";

function assertLive(signal?: AbortSignal) {
  if (!isTauri()) throw new AppError("memory/unavailable", "Book classification requires desktop storage");
  if (signal?.aborted) throw new AppError("memory/cancelled", "Classification owner cancelled");
}
export async function inspectBookClassification(bookId: string, signal?: AbortSignal): Promise<BookClassificationSnapshot | null> {
  validateClassificationBookId(bookId); assertLive(signal);
  const result = await invoke<BookClassificationSnapshot | null>("book_classification_inspect", { id: bookId });
  assertLive(signal); return result;
}
async function commit(draft: DomainEventDraft, expectedRevision: string | undefined, signal?: AbortSignal): Promise<BookClassificationReceipt> {
  assertLive(signal);
  const [event] = await mintEventRows([draft]);
  assertLive(signal);
  // Cancellation after native dispatch is not a rollback of the durable verdict.
  const result = await invoke<BookClassificationReceipt>("book_classification_commit", { event, expectedRevision });
  if (result.changed) broadcastDomainEventDrafts([draft]);
  return result;
}
export function changeBookClassification(input: BookClassificationChange, origin: EventOrigin, signal?: AbortSignal): Promise<BookClassificationReceipt> {
  const change = normalizeBookClassification(input);
  return commit({ type: "book.narrativityClassified", origin, payload: { bookId: change.bookId, narrativity: change.narrativity } }, change.expectedRevision, signal);
}
/** Internal pipeline operation; plugins and model tools must use conditional user changes. */
export async function classifyBookIfUnclassified(bookId: string, narrativity: DigestFlavor, signal?: AbortSignal): Promise<DigestFlavor> {
  validateClassificationBookId(bookId);
  if (narrativity !== "narrative" && narrativity !== "expository") throw new AppError("memory/invalid-input", "Invalid classification");
  const result = await commit({ type: "book.narrativityClassified", origin: "agent", payload: { bookId, narrativity, onlyIfUnclassified: true } }, undefined, signal);
  if (!result.snapshot.narrativity) throw new AppError("db/error", "Classification commit returned no verdict");
  return result.snapshot.narrativity;
}
