/** Reading domain - reading lifecycle, progress projections, and time. */
import type { BookStats, EventOrigin, StatsOverview } from "@read-aware/core";
import { listLibraryBooks, setLibraryBookFinished } from "../features/library/lib/library-db";
import type { LibraryBook } from "../features/library/lib/library-types";
import {
  loadReadingStatsStore,
  type BookReadingStats,
} from "../features/reader/lib/reading-stats";
import { emitAppEvent } from "../platform/app-events";
import {
  READING_EVENTS,
  domainSubscribe,
  type DomainEventSubscribe,
} from "./events";

function toBookStats(book: LibraryBook, time: BookReadingStats | undefined): BookStats {
  return {
    bookId: book.id,
    progressPercent: book.progressPercent ?? 0,
    status: book.readingStatus,
    locator: book.progress?.cfi ?? book.progress?.href ?? undefined,
    chapterHref: book.progress?.href ?? undefined,
    currentLocation: book.progress?.currentLocation,
    totalLocations: book.progress?.totalLocations,
    totalMs: time?.totalMs ?? 0,
    firstReadAt:
      time?.firstStartedAt != null ? new Date(time.firstStartedAt).toISOString() : undefined,
    lastReadAt:
      time?.lastReadAt != null ? new Date(time.lastReadAt).toISOString() : undefined,
    daily: { ...(time?.daily ?? {}) },
  };
}

export type ReadingQueries = {
  stats: {
    forBook(bookId: string): Promise<BookStats | null>;
    list(): Promise<BookStats[]>;
    overview(): Promise<StatsOverview>;
  };
};

export type ReadingCommands = {
  setFinished(bookId: string, finished: boolean): Promise<void>;
};

export type ReadingDomain = {
  queries: ReadingQueries;
  commands: ReadingCommands;
  events: {
    subscribe: DomainEventSubscribe<(typeof READING_EVENTS)[number]>;
  };
};

export function createReadingDomain(origin: EventOrigin): ReadingDomain {
  const queries: ReadingQueries = {
    stats: {
      forBook: async (bookId) => {
        const book = (await listLibraryBooks()).find((entry) => entry.id === String(bookId));
        if (!book) return null;
        const store = await loadReadingStatsStore();
        return toBookStats(book, store[book.id]);
      },
      list: async () => {
        const [allBooks, store] = await Promise.all([
          listLibraryBooks(),
          loadReadingStatsStore(),
        ]);
        return allBooks.map((book) => toBookStats(book, store[book.id]));
      },
      overview: async () => {
        const [allBooks, store] = await Promise.all([
          listLibraryBooks(),
          loadReadingStatsStore(),
        ]);
        const daily: Record<string, number> = {};
        let totalMs = 0;
        let first: number | null = null;
        let last: number | null = null;
        for (const entry of Object.values(store)) {
          totalMs += entry.totalMs;
          for (const [day, ms] of Object.entries(entry.daily)) {
            daily[day] = (daily[day] ?? 0) + ms;
          }
          if (
            entry.firstStartedAt != null &&
            (first == null || entry.firstStartedAt < first)
          ) {
            first = entry.firstStartedAt;
          }
          if (entry.lastReadAt != null && (last == null || entry.lastReadAt > last)) {
            last = entry.lastReadAt;
          }
        }
        return {
          totalMs,
          daily,
          firstReadAt: first != null ? new Date(first).toISOString() : undefined,
          lastReadAt: last != null ? new Date(last).toISOString() : undefined,
          booksReading: allBooks.filter((book) => book.readingStatus === "reading").length,
          booksFinished: allBooks.filter((book) => book.readingStatus === "finished").length,
        };
      },
    },
  };

  const commands: ReadingCommands = {
    setFinished: async (bookId, finished) => {
      await setLibraryBookFinished(String(bookId), finished === true, origin);
      emitAppEvent("library-changed", {});
    },
  };

  return {
    queries,
    commands,
    events: { subscribe: domainSubscribe(READING_EVENTS, origin) },
  };
}
