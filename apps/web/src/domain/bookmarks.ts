/**
 * Bookmarks — named reading targets in a book (`bookmark.*` events projected
 * into the `bookmarks` table; packages/core/src/bookmarks.ts owns the shape).
 *
 * Library data: bookmarks roam with the event log and follow book merges and
 * removals natively. Like the font registry, this is a host surface, not a
 * plugin capability domain: the reader UI and the agent's bookmark tools call
 * these functions directly.
 */
import {
  AppError,
  normalizeBookmarkName,
  normalizeBookmarkTarget,
  isBookmarkKind,
  type Bookmark,
  type BookmarkKind,
  type BookmarkTarget,
} from "@read-aware/core";
import { invoke } from "../platform/ipc";
import { isTauri } from "../platform/environment";
import { commitDomainEvents } from "../platform/domain-events";
import type { DomainActor } from "../platform/domain-actor";
import { observeBookmarkInvalidation } from "./projection-invalidation";

export { observeBookmarkInvalidation };

/** Bookmarks oldest first, for one book or (no id) the whole library. */
export async function listBookmarks(bookId?: string): Promise<Bookmark[]> {
  if (!isTauri()) return [];
  const rows = await invoke<Bookmark[]>("bookmarks_list", { bookId: bookId ?? null });
  return rows.filter((row) => isBookmarkKind(row.kind));
}

export type NewBookmark = {
  bookId: string;
  name: string;
  kind: BookmarkKind;
  target: BookmarkTarget;
  chapterHref?: string;
};

/** Validate before anything is committed; the native store re-checks. */
function prepared(input: NewBookmark): NewBookmark {
  const name = normalizeBookmarkName(input.name);
  const target = isBookmarkKind(input.kind) ? normalizeBookmarkTarget(input.target, input.kind) : null;
  if (!input.bookId || !name || !target)
    throw new AppError("bookmarks/invalid-input", "A bookmark needs a book, a name and a readable target");
  const chapterHref = input.chapterHref?.trim() ? input.chapterHref : undefined;
  return { bookId: input.bookId, name, kind: input.kind, target, ...(chapterHref ? { chapterHref } : {}) };
}

export type CreateBookmarkOptions = {
  origin?: DomainActor;
  /** Defaults to a fresh UUID; a migration passes a stable one to stay idempotent. */
  id?: string;
  /** When the bookmark was originally made (a migration keeps it). */
  createdAt?: string;
};

export async function createBookmark(input: NewBookmark, options: CreateBookmarkOptions = {}): Promise<Bookmark> {
  const bookmark = prepared(input);
  const id = options.id ?? crypto.randomUUID();
  await commitDomainEvents({
    type: "bookmark.created",
    origin: options.origin,
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    payload: { bookmarkId: id, ...bookmark },
  });
  const at = options.createdAt ?? new Date().toISOString();
  return { id, ...bookmark, createdAt: at, updatedAt: at };
}

export async function renameBookmark(
  bookmark: Pick<Bookmark, "id" | "bookId">,
  name: string,
  origin?: DomainActor,
): Promise<void> {
  const normalized = normalizeBookmarkName(name);
  if (!normalized) throw new AppError("bookmarks/invalid-input", "A bookmark name must be 1 to 120 characters");
  await commitDomainEvents({
    type: "bookmark.renamed",
    origin,
    payload: { bookmarkId: bookmark.id, bookId: bookmark.bookId, name: normalized },
  });
}

export async function removeBookmark(bookmark: Pick<Bookmark, "id" | "bookId">, origin?: DomainActor): Promise<void> {
  await commitDomainEvents({
    type: "bookmark.removed",
    origin,
    payload: { bookmarkId: bookmark.id, bookId: bookmark.bookId },
  });
}
