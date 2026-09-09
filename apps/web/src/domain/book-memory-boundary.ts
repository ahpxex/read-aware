import type { BookGraphBoundary } from "@read-aware/agent";
import type { DigestFlavor, ReadingSessionSnapshot } from "@read-aware/core";

/** Resolve only persisted chapter identities; querying memory never starts extraction. */
export function bookMemoryBoundary(
  book: { id: string; narrativity?: DigestFlavor | null; readingStatus: string; progress: { href: string | null } | null },
  session: ReadingSessionSnapshot,
  chapters: readonly { index: number; hrefs?: string[] }[] | null,
): BookGraphBoundary {
  if (book.narrativity === "expository" || book.readingStatus === "finished") return { kind: "all" };
  const href = session.bookId === book.id
    ? session.status === "ready" ? session.location?.href : undefined
    : book.progress?.href;
  if (!href || !chapters) return { kind: "unknown" };
  const base = (value: string) => value.split("#")[0];
  const ordered = [...chapters].sort((a, b) => a.index - b.index);
  const chapter = ordered.find(entry => entry.hrefs?.includes(href)) ?? ordered.find(entry => entry.hrefs?.some(candidate => base(candidate) === base(href)));
  return chapter ? { kind: "before", chapterIndex: chapter.index } : { kind: "unknown" };
}
