/**
 * Reading domain — positions, statuses, and active reading time. Read-only
 * by design for every actor: its events are recorded facts of reader
 * activity (the engine and the time tracker emit them), not user-intent
 * commands, so the domain has no command surface.
 */
import type { EventOrigin, ReadingState, ReadingTime } from "@read-aware/core";
import { listLibraryBooks } from "../features/library/lib/library-db";
import type { LibraryBook } from "../features/library/lib/library-types";
import {
  getBookReadingStats,
  getReadingStatsStore,
} from "../features/reader/lib/reading-stats";
import { READING_EVENTS, domainSubscribe, type DomainEventSubscribe } from "./events";

export function toReadingState(book: LibraryBook): ReadingState {
  return {
    bookId: book.id,
    progressPercent: book.progressPercent ?? 0,
    status: book.readingStatus,
    locator: book.progress?.cfi ?? book.progress?.href ?? undefined,
    chapterHref: book.progress?.href ?? undefined,
    currentLocation: book.progress?.currentLocation,
    totalLocations: book.progress?.totalLocations,
  };
}

export type ReadingDomain = {
  getState(bookId: string): Promise<ReadingState | null>;
  listStates(): Promise<ReadingState[]>;
  getTime(bookId: string): Promise<ReadingTime | null>;
  on: DomainEventSubscribe<(typeof READING_EVENTS)[number]>;
};

export function createReadingDomain(origin: EventOrigin): ReadingDomain {
  return {
    getState: async (bookId) => {
      const book = (await listLibraryBooks()).find((entry) => entry.id === String(bookId));
      return book ? toReadingState(book) : null;
    },
    listStates: async () => (await listLibraryBooks()).map(toReadingState),
    getTime: async (bookId) => {
      const store = getReadingStatsStore();
      if (!store[String(bookId)]) return null;
      const stats = getBookReadingStats(store, String(bookId));
      return {
        bookId: stats.bookId,
        totalMs: stats.totalMs,
        firstReadAt:
          stats.firstStartedAt != null
            ? new Date(stats.firstStartedAt).toISOString()
            : undefined,
        lastReadAt:
          stats.lastReadAt != null ? new Date(stats.lastReadAt).toISOString() : undefined,
        daily: { ...stats.daily },
      };
    },
    on: domainSubscribe(READING_EVENTS, origin),
  };
}
