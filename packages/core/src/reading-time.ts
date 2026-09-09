import { AppError } from "./errors";

export type ReadingTimeCursor = { bookId: string; localDay: string; localHour: number };
export type ReadingTimeQuery = {
  bookId?: string;
  /** Calendar day recorded by each session, not converted to today's timezone. */
  localDay?: string;
  after?: ReadingTimeCursor;
  limit?: number;
};
export type PendingReadingTime = ReadingTimeCursor & {
  ms: number;
  startedAt: number;
  lastAt: number;
  /** Page-turn observation clock; time ticks do not advance it. */
  positionAt: number | null;
};
export type ReadingTimeSnapshot = {
  bookId: string | null;
  localDay: string | null;
  /** Native wall clock inside the SQLite read transaction, not a revision. */
  observedAtEpochMs: number;
  settledMs: number;
  pendingMs: number;
  totalMs: number;
  pendingBucketCount: number;
  /** Bounded live keyset page; totals cover the entire scope, not just this page. */
  pending: PendingReadingTime[];
  nextCursor: ReadingTimeCursor | null;
};
export type ReadingTimeObservation =
  | { revision: number; status: "ready"; snapshot: ReadingTimeSnapshot }
  | { revision: number; status: "error"; errorCode: string };

export function normalizeReadingTimeQuery(input: ReadingTimeQuery = {}): ReadingTimeQuery & { limit: number } {
  const fail = (): never => { throw new AppError("reading/invalid-time-query", "Expected a reading time scope and bounded session cursor"); };
  const id = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 256;
  const day = (value: unknown): value is string => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail();
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100
    || (input.bookId !== undefined && !id(input.bookId))
    || (input.localDay !== undefined && !day(input.localDay))) return fail();
  const after = input.after;
  if (after !== undefined && (!after || typeof after !== "object" || Array.isArray(after)
    || !id(after.bookId) || !day(after.localDay) || !Number.isInteger(after.localHour) || after.localHour < 0 || after.localHour > 23
    || (input.bookId !== undefined && input.bookId !== after.bookId)
    || (input.localDay !== undefined && input.localDay !== after.localDay))) return fail();
  return { ...(input.bookId !== undefined ? { bookId: input.bookId } : {}),
    ...(input.localDay !== undefined ? { localDay: input.localDay } : {}),
    ...(after ? { after: { bookId: after.bookId, localDay: after.localDay, localHour: after.localHour } } : {}), limit };
}
