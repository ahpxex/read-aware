/**
 * Contents-panel branches the reader pinned open, remembered per book.
 *
 * Device-local presentation state (like `read-aware-navigator-state:<book>`):
 * it does not roam and has no events. The reader shell remounts on every book
 * open, so the pins live here rather than in component state. Folds of the
 * current chapter's path are transient and never stored (see toc-outline).
 */
import { localKV, onLocalKVChange } from "../../../platform/local-store";

export const tocFoldsKey = (bookId: string) => `read-aware-toc-folds:${bookId}`;

const NONE: ReadonlySet<string> = new Set();

export function parseTocPins(raw: string | null): ReadonlySet<string> {
  if (!raw) return NONE;
  try {
    const parsed = JSON.parse(raw) as { pinned?: unknown };
    if (!Array.isArray(parsed?.pinned)) return NONE;
    return new Set(parsed.pinned.filter((id): id is string => typeof id === "string"));
  } catch {
    // A malformed value only loses remembered folds; the panel falls back to
    // its default (current chapter's path open).
    return NONE;
  }
}

export const tocFoldsStore = {
  read: (bookId: string): string | null => localKV.getItem(tocFoldsKey(bookId)),
  subscribe: (bookId: string, listener: () => void): (() => void) => {
    const key = tocFoldsKey(bookId);
    return onLocalKVChange((changed) => {
      if (changed === key) listener();
    });
  },
};

/**
 * Store the pins, keeping only ids that are still branches of the book's
 * contents. Resolves once durable; on failure the local store rolls the value
 * back (re-rendering the panel) and reports it through `local-write-failed`.
 */
export function writeTocPins(bookId: string, pinned: Iterable<string>, branchIds: ReadonlySet<string>): Promise<void> {
  const ids = [...pinned].filter((id) => branchIds.has(id));
  const key = tocFoldsKey(bookId);
  if (!ids.length) return localKV.getItem(key) === null ? Promise.resolve() : localKV.removeItemAsync(key, "user");
  return localKV.setItemAsync(key, JSON.stringify({ pinned: ids }), "user");
}
