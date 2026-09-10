import { AppError, type EventOrigin } from "@read-aware/core";
import { createBookMemoryPort } from "../features/ai/agent/ports/book-memory-port";
import { createMemoryPort } from "../features/ai/agent/ports/memory-port";
import { getBookRecord } from "../features/library/lib/library-db";
import { getPersistedBookText } from "../features/library/lib/book-text-store";
import { readingRuntime } from "./reading-runtime";
import { createMemoryQueries } from "./memory-queries";
import { bookMemoryBoundary } from "./book-memory-boundary";
import { inspectMemory, mutateMemory } from "./memory-management";
import { inspectBookClassification, changeBookClassification } from "./book-classification";
import { MemoryObserver } from "./memory-observer";
import { createLogger } from "../platform/logger";
import { createBookGraphTasks } from "./book-graph-tasks";
import type { MemoryObservation, MemoryObservationQuery, MemoryObservationResult } from "@read-aware/core";

const log = createLogger("memory-observation");
const observer = new MemoryObserver({
  schedule: work => { const timer = setTimeout(work, 1000); return () => clearTimeout(timer); },
  report: error => log.warn("Memory observation failed", error),
});

/** Memory reads do not import books, construct digests, or grant raw projection writes. */
export function createMemoryDomain(origin: EventOrigin, lifetime?: AbortSignal) {
  const memory = createMemoryPort(), bookMemory = createBookMemoryPort();
  const tasks = createBookGraphTasks(lifetime);
  const queries = createMemoryQueries({ search: memory.searchMemories, graph: async bookId => {
    const digests = await bookMemory.listDigests(bookId);
    const chapters = await getPersistedBookText(bookId);
    const book = await getBookRecord(bookId);
    if (!book) throw new AppError("reader/book-not-found", "Book not found");
    const boundary = bookMemoryBoundary(book, readingRuntime.snapshot(), chapters?.map((chapter, index) => ({ index, hrefs: chapter.hrefs })) ?? null);
    return { digests, boundary, flavor: book.narrativity ?? undefined };
  } }, lifetime);
  const read = async (query: MemoryObservationQuery): Promise<MemoryObservationResult> => {
    if (query.kind === "search") return { kind: query.kind, memories: await queries.search(query.query) };
    if (query.kind === "inspect") return { kind: query.kind, snapshot: await inspectMemory(query.memoryId, lifetime) };
    if (query.kind === "classification") return { kind: query.kind, snapshot: await inspectBookClassification(query.bookId, lifetime) };
    if (query.kind === "graphTasks") return { kind: query.kind, tasks: await tasks.list(query.bookId) };
    if (query.kind === "graphTask") return { kind: query.kind, task: await tasks.get(query.bookId, query.taskId) };
    return { kind: query.kind, graph: await queries.bookGraph(query.bookId, query.query) };
  };
  return { queries: { ...queries, inspect: (id: string) => inspectMemory(id, lifetime), classification: (bookId: string) => inspectBookClassification(bookId, lifetime),
      listGraphTasks: (bookId: string) => tasks.list(bookId), getGraphTask: (bookId: string, taskId: string) => tasks.get(bookId, taskId) },
    commands: { mutate: (input: import("@read-aware/core").MemoryMutation) => mutateMemory(input, origin, lifetime),
      classify: (input: import("@read-aware/core").BookClassificationChange) => changeBookClassification(input, origin, lifetime),
      startGraphTask: (bookId: string, mode: "catch-up" | "rebuild", options?: import("@read-aware/core").BookGraphTaskOptions) => tasks.start(bookId, mode, options),
      cancelGraphTask: (bookId: string, taskId: string) => tasks.cancel(bookId, taskId),
      retryGraphTask: (bookId: string, taskId: string, options?: import("@read-aware/core").BookGraphTaskOptions) => tasks.retry(bookId, taskId, options) },
    events: { observe: (input: MemoryObservationQuery, handler: (event: MemoryObservation) => unknown) => observer.observe(input, read, handler, lifetime) } };
}
