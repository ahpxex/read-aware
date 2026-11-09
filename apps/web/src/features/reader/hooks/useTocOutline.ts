import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { createLogger } from "../../../platform/logger";
import type { TocEntry } from "../lib/reader-types";
import { parseTocPins, tocFoldsStore, writeTocPins } from "../lib/toc-folds";
import {
  buildTocOutline,
  buildTocOutlineView,
  tocAncestors,
  tocBranchIds,
  toggleTocFold,
  type TocOutlineView,
} from "../lib/toc-outline";

const log = createLogger("reader-toc");
const NONE: ReadonlySet<string> = new Set();
const sameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((id) => b.has(id));

/**
 * Foldable contents rows for one book: remembered pins, plus the current
 * chapter's path opened automatically (see lib/toc-outline).
 */
export function useTocOutline(
  bookId: string,
  entries: readonly TocEntry[],
  currentIndex: number,
): TocOutlineView & { toggle: (index: number) => void } {
  const outline = useMemo(() => buildTocOutline(entries), [entries]);
  const subscribe = useCallback((listener: () => void) => tocFoldsStore.subscribe(bookId, listener), [bookId]);
  const raw = useSyncExternalStore(subscribe, () => tocFoldsStore.read(bookId));
  const pinned = useMemo(() => parseTocPins(raw), [raw]);

  // Folds of the current path belong to this stay in the current chapter:
  // reaching another chapter reveals it again.
  const currentId = entries[currentIndex]?.id ?? null;
  const [stay, setStay] = useState<{ chapter: string | null; folded: ReadonlySet<string> }>({
    chapter: currentId,
    folded: NONE,
  });
  const folded = stay.chapter === currentId ? stay.folded : NONE;

  const view = useMemo(
    () => buildTocOutlineView(entries, outline, currentIndex, { pinned, folded }),
    [entries, outline, currentIndex, pinned, folded],
  );

  const toggle = useCallback(
    (index: number) => {
      const entry = entries[index];
      if (!entry || !outline.branches[index]) return;
      const onCurrentPath = tocAncestors(outline, currentIndex).includes(index);
      // Read the pins at the moment of the toggle: an earlier toggle's write is
      // already mirrored into the store even if this render predates it.
      const before = parseTocPins(tocFoldsStore.read(bookId));
      const next = toggleTocFold({ pinned: before, folded }, entry.id, onCurrentPath);
      if (!sameIds(next.folded, folded)) setStay({ chapter: currentId, folded: next.folded });
      if (!sameIds(next.pinned, before)) {
        writeTocPins(bookId, next.pinned, tocBranchIds(entries, outline)).catch((error: unknown) =>
          // The store has already rolled the pins back and toasted the failure.
          log.warn("Could not remember the contents folds", error),
        );
      }
    },
    [bookId, entries, outline, currentIndex, currentId, folded],
  );

  return { ...view, toggle };
}
