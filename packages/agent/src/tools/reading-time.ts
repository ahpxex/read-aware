import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, normalizeReadingTimeQuery, type ReadingTimeQuery } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";
import { normalizeBookIdParam } from "./current-book";
import { textResult } from "./tool-result";

export function buildReadingTimeTool(scope: ThreadScope, deps: RuntimeDeps): AgentTool {
  return {
    name: "get_reading_time", label: "Live reading time",
    description: "Read settled AND pending active reading time atomically. Use for current reading time, including the unfinished hour. This is locally persisted sampled time, not an extrapolated stopwatch or proof that all devices synced. localDay filters the calendar label recorded by sessions, not a timezone conversion. In book scope defaults to the current book; allBooks=true requests aggregate. Totals cover the full scope even when the pending-bucket list is paged; never sum totals across pages. No writes or forced flush.",
    parameters: Type.Object({ bookId: Type.Optional(Type.String()), allBooks: Type.Optional(Type.Boolean()),
      localDay: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
      after: Type.Optional(Type.Object({ bookId: Type.String(), localDay: Type.String(), localHour: Type.Integer({ minimum: 0, maximum: 23 }) })) }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const input = params as ReadingTimeQuery & { allBooks?: boolean };
      const bookId = input.allBooks ? undefined : normalizeBookIdParam(input.bookId) ?? (scope.kind === "book" ? String(scope.bookId) : undefined);
      const query = normalizeReadingTimeQuery({ ...input, bookId, limit: input.limit ?? 10 });
      if (query.limit > 10) throw new AppError("reading/invalid-time-query", "Agent reading time pages are limited to 10 buckets");
      const snapshot = await deps.library.getReadingTime(query);
      signal?.throwIfAborted();
      const value = { bookId: snapshot.bookId, localDay: snapshot.localDay,
        observedAt: new Date(snapshot.observedAtEpochMs).toISOString(),
        totalReadingSeconds: snapshot.totalMs / 1000,
        settledReadingSeconds: snapshot.settledMs / 1000, pendingReadingSeconds: snapshot.pendingMs / 1000,
        pendingBucketCount: snapshot.pendingBucketCount,
        pending: snapshot.pending.map(bucket => ({ bookId: bucket.bookId, localDay: bucket.localDay,
          localHour: bucket.localHour, readingSeconds: bucket.ms / 1000,
          startedAt: new Date(bucket.startedAt).toISOString(), lastAt: new Date(bucket.lastAt).toISOString(),
          positionAt: bucket.positionAt === null ? null : new Date(bucket.positionAt).toISOString() })),
        nextCursor: snapshot.nextCursor };
      // Escaped identifiers can be much larger than their input length. Keep
      // the model page bounded without discarding the continuation position.
      while (JSON.stringify(value).length > 16_000 && value.pending.length > 1) {
        value.pending.pop();
        const last = value.pending[value.pending.length - 1];
        value.nextCursor = { bookId: last.bookId, localDay: last.localDay, localHour: last.localHour };
      }
      return textResult(value);
    },
  };
}
