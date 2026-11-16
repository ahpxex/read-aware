/** A run of threads last active in the same stretch of time, newest first. */
export type ThreadGroup<T> = {
  /** A fixed stretch, or a calendar month (`YYYY-MM`) beyond the last 30 days. */
  key: "today" | "yesterday" | "previous7" | "previous30" | "older" | `month:${string}`;
  items: T[];
};

const DAY_MS = 86_400_000;

/** Local midnight of the day `time` falls on. */
function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Whole local calendar days between two midnights (DST days are 23 or 25 hours). */
function daysBetween(laterMidnight: number, earlierMidnight: number): number {
  return Math.round((laterMidnight - earlierMidnight) / DAY_MS);
}

/**
 * Group threads by when they were last active, on the local calendar: today,
 * yesterday, the previous 7 and 30 days, then one group per month. A thread
 * with no readable time (or one dated in the future, from a skewed clock)
 * goes to "today" if future and to a trailing "older" group if unreadable.
 * Order within a group follows `updatedAt`, newest first.
 */
export function groupThreadsByDate<T extends { updatedAt: string }>(
  threads: readonly T[],
  now: number,
): ThreadGroup<T>[] {
  const today = startOfDay(now);
  const dated = threads
    .map((thread) => ({ thread, time: Date.parse(thread.updatedAt) }))
    .sort((a, b) => (Number.isNaN(b.time) ? -1 : Number.isNaN(a.time) ? 1 : b.time - a.time));
  const groups: ThreadGroup<T>[] = [];
  const push = (key: ThreadGroup<T>["key"], thread: T) => {
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(thread);
    else groups.push({ key, items: [thread] });
  };
  for (const { thread, time } of dated) {
    if (Number.isNaN(time)) {
      push("older", thread);
      continue;
    }
    const age = daysBetween(today, startOfDay(time));
    if (age <= 0) push("today", thread);
    else if (age === 1) push("yesterday", thread);
    else if (age <= 7) push("previous7", thread);
    else if (age <= 30) push("previous30", thread);
    else {
      const date = new Date(time);
      push(`month:${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`, thread);
    }
  }
  return groups;
}
