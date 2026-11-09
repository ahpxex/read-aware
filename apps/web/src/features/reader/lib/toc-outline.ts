/**
 * The folding structure of the contents panel.
 *
 * The panel keeps the flat `TocEntry[]` every other reader path uses (chapter
 * steps, progress marks, fractions); the tree is recovered from the depth run:
 * an entry's parent is the nearest earlier entry that is shallower, and its
 * subtree is the deeper entries that directly follow it.
 *
 * A branch is open when the reader pinned it open, or when it holds the current
 * chapter and the reader has not folded it during this stay in that chapter.
 * Pins are remembered per book (`toc-folds`); the current-chapter folds are
 * transient, so moving to another chapter reveals where the reader now is.
 */
import type { TocEntry } from "./reader-types";

export type TocOutline = {
  /** Parent entry index per entry, or -1 at the top level. */
  parents: readonly number[];
  /** Whether each entry has children. */
  branches: readonly boolean[];
};

export function buildTocOutline(entries: readonly Pick<TocEntry, "depth">[]): TocOutline {
  const parents = Array.from({ length: entries.length }, () => -1);
  const branches = Array.from({ length: entries.length }, () => false);
  const open: number[] = [];
  entries.forEach((entry, index) => {
    while (open.length && entries[open[open.length - 1]].depth >= entry.depth) open.pop();
    const parent = open.length ? open[open.length - 1] : -1;
    parents[index] = parent;
    if (parent >= 0) branches[parent] = true;
    open.push(index);
  });
  return { parents, branches };
}

/** The entry's ancestors, nearest first. */
export function tocAncestors(outline: TocOutline, index: number): number[] {
  const ancestors: number[] = [];
  if (index < 0 || index >= outline.parents.length) return ancestors;
  for (let parent = outline.parents[index]; parent >= 0; parent = outline.parents[parent]) ancestors.push(parent);
  return ancestors;
}

export type TocFolds = {
  /** Branches the reader opened; remembered for the book. */
  pinned: ReadonlySet<string>;
  /** Branches on the current chapter's path the reader folded during this stay. */
  folded: ReadonlySet<string>;
};

export function isTocBranchOpen(id: string, onCurrentPath: boolean, folds: TocFolds): boolean {
  return folds.pinned.has(id) || (onCurrentPath && !folds.folded.has(id));
}

/** Flip one branch. Opening a current-path branch only lifts its fold: it is
 * open because it holds the current chapter, not because the reader pinned it. */
export function toggleTocFold(folds: TocFolds, id: string, onCurrentPath: boolean): TocFolds {
  const pinned = new Set(folds.pinned);
  const folded = new Set(folds.folded);
  if (isTocBranchOpen(id, onCurrentPath, folds)) {
    pinned.delete(id);
    if (onCurrentPath) folded.add(id);
  } else if (onCurrentPath) folded.delete(id);
  else pinned.add(id);
  return { pinned, folded };
}

export type TocOutlineRow = {
  /** Index into the flat entries. */
  index: number;
  entry: TocEntry;
  branch: boolean;
  open: boolean;
};

export type TocOutlineView = {
  rows: TocOutlineRow[];
  /**
   * The row standing for the current chapter: its own row, or — while a
   * branch above it is folded — the outermost folded ancestor. -1 when no
   * chapter is current.
   */
  currentRow: number;
};

export function buildTocOutlineView(
  entries: readonly TocEntry[],
  outline: TocOutline,
  currentIndex: number,
  folds: TocFolds,
): TocOutlineView {
  const ancestors = tocAncestors(outline, currentIndex);
  const currentPath = new Set(ancestors);
  const rows: TocOutlineRow[] = [];
  const rowOf = new Map<number, number>();
  // Inside a folded branch, skip every entry deeper than it.
  let hiddenBelow = Number.POSITIVE_INFINITY;
  entries.forEach((entry, index) => {
    if (entry.depth > hiddenBelow) return;
    hiddenBelow = Number.POSITIVE_INFINITY;
    const branch = outline.branches[index];
    const open = branch && isTocBranchOpen(entry.id, currentPath.has(index), folds);
    rowOf.set(index, rows.length);
    rows.push({ index, entry, branch, open });
    if (branch && !open) hiddenBelow = entry.depth;
  });
  if (currentIndex < 0 || currentIndex >= entries.length) return { rows, currentRow: -1 };
  // The outermost folded ancestor is always visible: everything above it is open.
  let standIn = currentIndex;
  for (const ancestor of ancestors) if (!isTocBranchOpen(entries[ancestor].id, true, folds)) standIn = ancestor;
  return { rows, currentRow: rowOf.get(standIn) ?? -1 };
}

/** The branch ids of the outline, for pruning remembered pins. */
export function tocBranchIds(entries: readonly TocEntry[], outline: TocOutline): Set<string> {
  const ids = new Set<string>();
  entries.forEach((entry, index) => {
    if (outline.branches[index]) ids.add(entry.id);
  });
  return ids;
}
