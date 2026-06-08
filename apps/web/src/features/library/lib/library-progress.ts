import type { BookProgress, LibraryBook, ReadingStatus } from "./library-types";

export function getReadingStatus(progressPercent: number): ReadingStatus {
  if (progressPercent >= 100) return "finished";
  if (progressPercent > 0) return "reading";
  return "unread";
}

export function createProgressPatch(
  book: LibraryBook,
  progress: BookProgress,
  timestamp = new Date().toISOString(),
): LibraryBook {
  const progressPercent = progress ? Math.max(0, Math.min(100, Math.round(progress.progressPercent))) : 0;

  return {
    ...book,
    progress,
    progressPercent,
    readingStatus: getReadingStatus(progressPercent),
    updatedAt: timestamp,
    lastOpenedAt: timestamp,
  };
}
