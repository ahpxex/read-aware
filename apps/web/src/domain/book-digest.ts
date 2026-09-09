import { AppError, validateClassificationBookId, type BookDigestSnapshot, type ChapterDigest } from "@read-aware/core";
import { invoke } from "../platform/ipc";
import { isTauri } from "../platform/environment";
import { broadcastDomainEventDrafts, mintEventRows, type DomainEventDraft } from "../platform/domain-events";

function assertLive(signal?: AbortSignal) {
  if (!isTauri()) throw new AppError("memory/unavailable", "Digest storage requires desktop");
  if (signal?.aborted) throw new AppError("memory/cancelled", "Digest owner cancelled");
}
function validateTarget(bookId: string, chapterIndex: number) {
  validateClassificationBookId(bookId);
  if (!Number.isSafeInteger(chapterIndex) || chapterIndex < 0) throw new AppError("memory/invalid-input", "Invalid digest chapter");
}
export async function inspectBookDigest(bookId: string, chapterIndex: number, signal?: AbortSignal): Promise<BookDigestSnapshot | null> {
  validateTarget(bookId, chapterIndex); assertLive(signal);
  const snapshot = await invoke<BookDigestSnapshot | null>("book_digest_inspect", { id: bookId, chapterIndex });
  assertLive(signal); return snapshot;
}
export async function saveBookDigest(bookId: string, digest: ChapterDigest, expectedRevision: string, signal?: AbortSignal): Promise<void> {
  validateTarget(bookId, digest.chapterIndex);
  if (typeof expectedRevision !== "string" || !/^bdg1:[a-f0-9]{64}$/.test(expectedRevision)) throw new AppError("memory/invalid-input", "Missing digest revision");
  const copy = structuredClone(digest);
  const draft: DomainEventDraft = { type: "book.chapterDigested", origin: "agent", payload: { ...copy, bookId, flavor: copy.flavor ?? "narrative" } };
  assertLive(signal);
  const [event] = await mintEventRows([draft]);
  assertLive(signal);
  await invoke<BookDigestSnapshot>("book_digest_commit", { event, expectedRevision });
  broadcastDomainEventDrafts([draft]);
}
