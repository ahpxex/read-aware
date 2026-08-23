/**
 * Deterministic sample data for the stats stories.
 *
 * One shared module rather than four inlined copies: PeriodOverview,
 * BookBreakdown, Achievements and StatsWorkspace all need the same shape of
 * reading store, and hand-rolled duplicates would drift apart the first time
 * the store type gains a field. Nothing in the product imports this — it is
 * story-only, and every value is derived from a fixed seed, so the shape of
 * the charts is identical on every mount.
 */
import type { LibraryBook } from "../../library/lib/library-types";
import {
  emptyHourBuckets,
  localDayKey,
  type BookReadingStats,
  type ReadingStatsStore,
} from "../../reader/lib/reading-stats";
import type { AnnotationCounts } from "../hooks/useAnnotationCounts";

/**
 * The clock the sample history is anchored to, resolved once at load.
 *
 * It is deliberately NOT a fixed date. `StatsWorkspace` reads `Date.now()`
 * itself, so a history pinned to some day in the past would leave its Week and
 * Month tabs empty and get emptier as time passed. Anchoring to load time keeps
 * every relative window populated; the *shape* of the data stays deterministic,
 * because it is seeded rather than random.
 */
export const NOW = Date.now();

const MINUTE = 60_000;

/** Knuth-style integer hash: stable pseudo-randomness with no Math.random. */
function seeded(n: number): number {
  return ((n * 2654435761) >>> 0) / 0xffffffff;
}

type BookSeedOptions = {
  /** How far back this book's reading history reaches, in days. */
  days: number;
  /** Rough share of days actually read (0..1). */
  density: number;
  /** Typical session length in minutes; actual sessions vary around it. */
  minutesPerDay: number;
  /** Offset into the hash space so two books never share a pattern. */
  seed: number;
  /** Days ago the book was last touched (default 0 — read today). */
  lastReadDaysAgo?: number;
};

/**
 * One book's reading history: a daily map plus the hour histogram implied by
 * it. Sessions land in a book-specific band of the clock (an evening reader,
 * a commuter) so TimeOfDayChart has a real peak to ink.
 */
function seedBook(bookId: string, options: BookSeedOptions): BookReadingStats {
  const { days, density, minutesPerDay, seed, lastReadDaysAgo = 0 } = options;
  const daily: Record<string, number> = {};
  const byHour = emptyHourBuckets();
  let totalMs = 0;
  let firstStartedAt: number | null = null;
  let lastReadAt: number | null = null;

  // The book's habitual reading hour, plus an hour of jitter each session.
  const baseHour = 7 + Math.floor(seeded(seed) * 14);

  for (let i = lastReadDaysAgo; i < days + lastReadDaysAgo; i += 1) {
    const roll = seeded(seed + i * 7919);
    if (roll > density) continue;

    const day = new Date(NOW);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - i);

    // 0.4×..1.9× the typical session, so bars have honest variance.
    const minutes = Math.max(3, Math.round(minutesPerDay * (0.4 + roll * 1.5)));
    const ms = minutes * MINUTE;
    daily[localDayKey(day.getTime())] = ms;
    totalMs += ms;

    const hour = (baseHour + Math.floor(seeded(seed + i) * 2)) % 24;
    byHour[hour] += ms;

    const at = day.getTime() + hour * 3600_000;
    if (lastReadAt === null) lastReadAt = at;
    firstStartedAt = at;
  }

  return { bookId, firstStartedAt, lastReadAt, totalMs, daily, byHour };
}

const BOOK_META: {
  id: string;
  title: string;
  author: string;
  progressPercent: number;
  readingStatus: LibraryBook["readingStatus"];
}[] = [
  {
    id: "book-pale-fire",
    title: "Pale Fire",
    author: "Vladimir Nabokov",
    progressPercent: 62,
    readingStatus: "reading",
  },
  {
    id: "book-tractatus",
    title: "Tractatus Logico-Philosophicus",
    author: "Ludwig Wittgenstein",
    progressPercent: 100,
    readingStatus: "finished",
  },
  {
    id: "book-sea",
    title: "The Sea, The Sea",
    author: "Iris Murdoch",
    progressPercent: 24,
    readingStatus: "reading",
  },
  {
    id: "book-annals",
    title: "The Annals of the Former World",
    author: "John McPhee",
    progressPercent: 8,
    readingStatus: "reading",
  },
];

/** Four books with plausible metadata, matching the seeded store's ids. */
export const sampleBooks: LibraryBook[] = BOOK_META.map((meta, index) => ({
  id: meta.id,
  title: meta.title,
  author: meta.author,
  format: "epub",
  fileName: `${meta.id}.epub`,
  mimeType: "application/epub+zip",
  fileSize: 1_400_000 + index * 320_000,
  coverUrl: null,
  coverChecked: true,
  createdAt: new Date(NOW - 540 * 86_400_000).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
  lastOpenedAt: new Date(NOW).toISOString(),
  progressPercent: meta.progressPercent,
  readingStatus: meta.readingStatus,
  progress: {
    currentLocation: 120 + index * 30,
    totalLocations: 480,
    progressPercent: meta.progressPercent,
    cfi: null,
    href: null,
  },
  starred: index === 0,
}));

/**
 * A year-and-a-half of reading across four books: one heavy daily habit, one
 * finished a while back, one sporadic, one barely started. Enough spread that
 * every period tab (week → all) has something to show.
 */
export const sampleStore: ReadingStatsStore = {
  "book-pale-fire": seedBook("book-pale-fire", {
    days: 540,
    density: 0.62,
    minutesPerDay: 42,
    seed: 11,
  }),
  "book-tractatus": seedBook("book-tractatus", {
    days: 90,
    density: 0.45,
    minutesPerDay: 25,
    seed: 29,
    lastReadDaysAgo: 40,
  }),
  "book-sea": seedBook("book-sea", {
    days: 200,
    density: 0.22,
    minutesPerDay: 55,
    seed: 47,
    lastReadDaysAgo: 2,
  }),
  "book-annals": seedBook("book-annals", {
    days: 21,
    density: 0.3,
    minutesPerDay: 18,
    seed: 83,
  }),
};

/** A store with a single book read only this week — the "just started" shape. */
export const freshStore: ReadingStatsStore = {
  "book-annals": seedBook("book-annals", {
    days: 6,
    density: 0.8,
    minutesPerDay: 22,
    seed: 5,
  }),
};

/** Nothing recorded yet: the empty state every period tab must survive. */
export const emptyStore: ReadingStatsStore = {};

/** Annotation counts keyed to the sample books; `refresh` is inert in stories. */
export const sampleAnnotations: AnnotationCounts = {
  notes: 34,
  highlights: 128,
  total: 162,
  byBook: new Map([
    ["book-pale-fire", { notes: 21, highlights: 74, total: 95 }],
    ["book-tractatus", { notes: 11, highlights: 38, total: 49 }],
    ["book-sea", { notes: 2, highlights: 16, total: 18 }],
  ]),
  isLoading: false,
  refresh: async () => {},
};

/** The all-zero counterpart, for stories showing books with no annotations. */
export const emptyAnnotations: AnnotationCounts = {
  notes: 0,
  highlights: 0,
  total: 0,
  byBook: new Map(),
  isLoading: false,
  refresh: async () => {},
};
