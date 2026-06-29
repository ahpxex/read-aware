/**
 * Dev-only synthetic reading history.
 *
 * Fabricates a believable `ReadingStatsStore` over real library book ids so the
 * stats surfaces have something alive to render before genuine reading time
 * accrues. Keyed by the actual books so the by-book breakdown and library joins
 * line up. Not shipped behavior — gate every caller behind `import.meta.env.DEV`.
 */

import type { LibraryBook } from "../../library/lib/library-types";
import {
  emptyHourBuckets,
  localDayKey,
  type BookReadingStats,
  type DailyReadingMap,
  type ReadingStatsStore,
} from "../../reader/lib/reading-stats";

/**
 * Relative likelihood of reading in each local hour — quiet overnight, a small
 * morning bump, a lunch blip, and a strong evening peak. Shapes the hour-of-day
 * histogram so "when you read" looks like a real person's rhythm.
 */
const HOUR_WEIGHTS = [
  0.2, 0.1, 0.05, 0.05, 0.05, 0.1, 0.4, 1.0, 1.2, 0.7, 0.5, 0.5,
  0.9, 0.8, 0.4, 0.4, 0.5, 0.7, 0.9, 1.4, 1.8, 2.0, 1.5, 0.7,
];

const HOUR_WEIGHT_TOTAL = HOUR_WEIGHTS.reduce((a, b) => a + b, 0);

/** Sample an hour-of-day weighted toward the reading peaks above. */
function pickHour(): number {
  let r = Math.random() * HOUR_WEIGHT_TOTAL;
  for (let h = 0; h < 24; h += 1) {
    r -= HOUR_WEIGHTS[h];
    if (r <= 0) return h;
  }
  return 21;
}

type SeedProfile = {
  /** How far back this book's history reaches. */
  startDaysAgo: number;
  /** Probability of a reading session on any given day. */
  frequency: number;
  minMinutes: number;
  maxMinutes: number;
  /** Trailing days forced to have reading, to plant a current streak. */
  streakDays: number;
};

const PROFILES: SeedProfile[] = [
  { startDaysAgo: 400, frequency: 0.55, minMinutes: 10, maxMinutes: 70, streakDays: 5 },
  { startDaysAgo: 300, frequency: 0.4, minMinutes: 8, maxMinutes: 45, streakDays: 0 },
  { startDaysAgo: 210, frequency: 0.5, minMinutes: 12, maxMinutes: 60, streakDays: 0 },
  { startDaysAgo: 160, frequency: 0.3, minMinutes: 8, maxMinutes: 30, streakDays: 0 },
  { startDaysAgo: 95, frequency: 0.45, minMinutes: 10, maxMinutes: 50, streakDays: 0 },
  { startDaysAgo: 60, frequency: 0.6, minMinutes: 8, maxMinutes: 40, streakDays: 3 },
  { startDaysAgo: 30, frequency: 0.35, minMinutes: 6, maxMinutes: 25, streakDays: 0 },
  { startDaysAgo: 14, frequency: 0.5, minMinutes: 8, maxMinutes: 35, streakDays: 0 },
];

function seedBook(bookId: string, now: number, profile: SeedProfile): BookReadingStats {
  const daily: DailyReadingMap = {};
  const byHour = emptyHourBuckets();
  let firstStartedAt: number | null = null;
  let lastReadAt: number | null = null;
  let totalMs = 0;

  for (let offset = profile.startDaysAgo; offset >= 0; offset -= 1) {
    const forced = offset < profile.streakDays;
    if (!forced && Math.random() > profile.frequency) continue;

    const minutes = Math.round(
      profile.minMinutes + Math.random() * (profile.maxMinutes - profile.minMinutes),
    );
    if (minutes <= 0) continue;
    const ms = minutes * 60_000;

    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - offset);
    const key = localDayKey(day.getTime());
    daily[key] = (daily[key] ?? 0) + ms;
    totalMs += ms;

    // Attribute the day's reading to one or two evening-biased hour buckets.
    const sessions = Math.random() < 0.4 ? 2 : 1;
    let remaining = ms;
    let lastHour = 21;
    for (let s = 0; s < sessions; s += 1) {
      lastHour = pickHour();
      const part = s === sessions - 1 ? remaining : Math.round(ms / sessions);
      byHour[lastHour] += part;
      remaining -= part;
    }

    const ts = new Date(day);
    ts.setHours(lastHour, 30, 0, 0);
    if (firstStartedAt === null) firstStartedAt = ts.getTime();
    lastReadAt = ts.getTime();
  }

  return { bookId, firstStartedAt, lastReadAt, totalMs, daily, byHour };
}

/**
 * Build a synthetic store over the given library books (up to 8), each with its
 * own reading cadence and a couple carrying a live streak through today.
 */
export function seedReadingStats(books: LibraryBook[], now: number): ReadingStatsStore {
  const store: ReadingStatsStore = {};
  books.slice(0, PROFILES.length).forEach((book, i) => {
    store[book.id] = seedBook(book.id, now, PROFILES[i]);
  });
  return store;
}
