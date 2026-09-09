import type { ChapterDigest, DigestFlavor } from "@read-aware/core";

/** Trusted host policy, never a caller-controlled graph query parameter. */
export type BookGraphBoundary = { kind: "all" } | { kind: "before"; chapterIndex: number } | { kind: "unknown" };
export type ChapterMemoryPolicy = { flavor: DigestFlavor; boundary: BookGraphBoundary };

export function chapterMemoryPolicy(
  book: { narrativity?: DigestFlavor | null; status?: string } | undefined,
  currentChapterIndex?: number,
): ChapterMemoryPolicy {
  const flavor = book?.narrativity ?? "narrative";
  if (book && (flavor === "expository" || book.status === "finished")) return { flavor, boundary: { kind: "all" } };
  if (book && currentChapterIndex !== undefined && Number.isSafeInteger(currentChapterIndex) && currentChapterIndex >= 0) {
    return { flavor, boundary: { kind: "before", chapterIndex: currentChapterIndex } };
  }
  return { flavor, boundary: { kind: "unknown" } };
}

/** Apply policy before alias/relationship merging or prompt roster selection. */
export function visibleChapterDigests(digests: readonly ChapterDigest[], boundary: BookGraphBoundary, flavor: DigestFlavor = "narrative"): ChapterDigest[] {
  if (boundary.kind === "unknown" || (boundary.kind === "before" && (!Number.isSafeInteger(boundary.chapterIndex) || boundary.chapterIndex < 0))) return [];
  return digests.filter(digest => (digest.flavor ?? "narrative") === flavor &&
    (boundary.kind !== "before" || digest.chapterIndex < boundary.chapterIndex))
    .sort((a, b) => a.chapterIndex - b.chapterIndex);
}
