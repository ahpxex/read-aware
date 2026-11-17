import type { ChapterDigest, DigestFlavor } from "@read-aware/core";

/** Trusted host policy, never a caller-controlled graph query parameter. */
export type BookGraphBoundary = { kind: "all" } | { kind: "before"; chapterIndex: number } | { kind: "unknown" };
export type ChapterMemoryPolicy = { flavor: DigestFlavor; boundary: BookGraphBoundary };

type PolicyBook = { narrativity?: DigestFlavor | null; spoilerSensitive?: boolean | null; status?: string };

/**
 * The one verdict on whether a book's plot is protected for its reader. The
 * reader's own setting (a user classification) is final; the background
 * classifier only fills a missing flag; an unclassified book stays protected.
 * The fence, the spoiler card, the prompt and the graph boundary all read this.
 */
export function needsSpoilerProtection(book: PolicyBook | undefined): boolean {
  return book?.status !== "finished" && (book?.spoilerSensitive ?? book?.narrativity !== "expository");
}

export function chapterMemoryPolicy(book: PolicyBook | undefined, currentChapterIndex?: number): ChapterMemoryPolicy {
  const flavor = book?.narrativity ?? "narrative";
  if (book && !needsSpoilerProtection(book)) return { flavor, boundary: { kind: "all" } };
  if (
    book &&
    currentChapterIndex !== undefined &&
    Number.isSafeInteger(currentChapterIndex) &&
    currentChapterIndex >= 0
  ) {
    return { flavor, boundary: { kind: "before", chapterIndex: currentChapterIndex } };
  }
  return { flavor, boundary: { kind: "unknown" } };
}

/** Apply policy before alias/relationship merging or prompt roster selection. */
export function visibleChapterDigests(
  digests: readonly ChapterDigest[],
  boundary: BookGraphBoundary,
  flavor: DigestFlavor = "narrative",
): ChapterDigest[] {
  if (
    boundary.kind === "unknown" ||
    (boundary.kind === "before" && (!Number.isSafeInteger(boundary.chapterIndex) || boundary.chapterIndex < 0))
  )
    return [];
  return digests
    .filter(
      (digest) =>
        (digest.flavor ?? "narrative") === flavor &&
        (boundary.kind !== "before" || digest.chapterIndex < boundary.chapterIndex),
    )
    .sort((a, b) => a.chapterIndex - b.chapterIndex);
}
