import { AppError, type BookMergePreview, type BookMergeReceipt, type BookMergeRequest, type DuplicateBookPage,
  type DuplicateBookQuery, type EventOrigin } from "@read-aware/core";
import { invoke } from "../platform/ipc";
import { isTauri } from "../platform/environment";
import { mintEventRows, broadcastDomainEventDrafts, type DomainEventDraft } from "../platform/domain-events";
import { emitAppEvent } from "../platform/app-events";

function live(signal?: AbortSignal) {
  if (!isTauri()) throw new AppError("ui/unavailable", "Duplicate management requires desktop storage");
  signal?.throwIfAborted();
}
function id(value: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 256) throw new AppError("ui/invalid-target", "Invalid book ID");
}
export async function listDuplicateBooks(query: DuplicateBookQuery = {}, signal?: AbortSignal): Promise<DuplicateBookPage> {
  if (!query || typeof query !== "object" || Array.isArray(query) || Object.keys(query).some(key => !["offset", "limit"].includes(key))) throw new AppError("ui/invalid-target", "Invalid duplicate query");
  const { offset = 0, limit = 20 } = query;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new AppError("ui/invalid-target", "Invalid duplicate page");
  live(signal); const page = await invoke<DuplicateBookPage>("library_duplicate_groups", { offset, limit }); live(signal); return page;
}
export async function previewBookMerge(bookId: string, signal?: AbortSignal): Promise<BookMergePreview | null> {
  id(bookId); live(signal); const preview = await invoke<BookMergePreview | null>("library_merge_preview", { bookId }); live(signal); return preview;
}
export async function resolveMergedBook(bookId: string, signal?: AbortSignal): Promise<string | null> {
  id(bookId); live(signal); const resolved = await invoke<string | null>("library_resolve_book", { bookId }); live(signal); return resolved;
}
export async function mergeDuplicateBooks(input: BookMergeRequest, origin: EventOrigin, signal?: AbortSignal): Promise<BookMergeReceipt> {
  if (!input || typeof input !== "object" || Object.keys(input).some(key => !["bookId", "expectedRevision"].includes(key))) throw new AppError("ui/invalid-target", "Invalid merge request");
  const { bookId, expectedRevision } = input; id(bookId);
  if (typeof expectedRevision !== "string" || !/^bmg1:[a-f0-9]{64}$/.test(expectedRevision)) throw new AppError("ui/invalid-target", "A current merge preview is required");
  const preview = await previewBookMerge(bookId, signal);
  if (!preview || preview.revision !== expectedRevision) throw new AppError("ui/superseded", "Duplicate books changed; preview again");
  const drafts: DomainEventDraft[] = preview.merged.map(member => ({ type: "book.merged", origin,
    payload: { keepId: preview.keep.id, mergedId: member.id } }));
  const events = await mintEventRows(drafts); live(signal);
  const receipt = await invoke<BookMergeReceipt>("library_merge_commit", { bookId, expectedRevision, events });
  broadcastDomainEventDrafts(drafts); emitAppEvent("library-changed", {});
  return receipt;
}
