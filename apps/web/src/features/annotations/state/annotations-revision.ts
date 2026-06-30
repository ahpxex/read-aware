import { atom } from "jotai";

/**
 * A monotonically increasing counter bumped whenever a book's annotations change
 * (highlight/underline/note created, deleted, or recolored). Annotations are
 * persisted to IndexedDB with no reactive layer, so views that merely *list*
 * them — notably the reader's TOC annotation indicators and the chapter flyout,
 * which live in a different component from where marks are created — would
 * otherwise go stale until remount. `useBookAnnotations` re-reads on every bump,
 * keeping those views live.
 */
export const annotationsRevisionAtom = atom(0);
