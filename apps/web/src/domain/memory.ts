import { AppError, FULL_DOMAIN_GRANTS, type DomainGrants, type EventOrigin } from "@read-aware/core";
import { createBookMemoryPort } from "../features/ai/agent/ports/book-memory-port";
import { createMemoryPort } from "../features/ai/agent/ports/memory-port";
import { createProfilePort } from "../features/ai/agent/ports/profile-port";
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
import { changeUserProfile } from "./user-profile";
import { decideEntity, queryEntities } from "./entity-registry";
import { inspectProfileContext } from "./identity-consolidation";
import { contextBundleAccess } from "./context-bundle-access";
import type { ResourceOwner } from "../services/resource-owner";
import type { MemoryObservation, MemoryObservationQuery, MemoryObservationResult } from "@read-aware/core";

const log = createLogger("memory-observation");
const observer = new MemoryObserver({
  schedule: work => { const timer = setTimeout(work, 1000); return () => clearTimeout(timer); },
  report: error => log.warn("Memory observation failed", error),
});

/** Memory reads do not import books, construct digests, or grant raw projection writes.
 * Context bundles also check the recipe's other source domains against the actor's grants. */
export function createMemoryDomain(origin: EventOrigin, lifetime?: AbortSignal, trackCleanup?: (work: Promise<void>) => void, grants: DomainGrants = FULL_DOMAIN_GRANTS) {
  const entitySignal = (signal?: AbortSignal) => lifetime && signal ? AbortSignal.any([lifetime, signal]) : lifetime ?? signal;
  const context = contextBundleAccess({ origin, grants, lifetime });
  const memory = createMemoryPort(), bookMemory = createBookMemoryPort();
  const profile = (query?: import("@read-aware/core").UserProfileQuery) => createProfilePort().readProfile(query, lifetime);
  const profileContext = (query?: import("@read-aware/core").ProfileInspectionQuery, signal?: AbortSignal) => inspectProfileContext(query, entitySignal(signal));
  const tasks = createBookGraphTasks(lifetime);
  const queries = createMemoryQueries({ search: memory.searchMemories, page: memory.pageMemories, graph: async bookId => {
    const digests = await bookMemory.listDigests(bookId);
    const chapters = await getPersistedBookText(bookId);
    const book = await getBookRecord(bookId);
    if (!book) throw new AppError("reader/book-not-found", "Book not found");
    const boundary = bookMemoryBoundary(book, readingRuntime.snapshot(), chapters?.map((chapter, index) => ({ index, hrefs: chapter.hrefs })) ?? null);
    return { digests, boundary, flavor: book.narrativity ?? undefined };
  } }, lifetime);
  const read = async (query: MemoryObservationQuery): Promise<MemoryObservationResult> => {
    if (query.kind === "profile") return { kind: query.kind, profile: await profile(query.query) };
    if (query.kind === "profileContext") return { kind: query.kind, page: await profileContext(query.query) };
    if (query.kind === "search") return { kind: query.kind, memories: await queries.search(query.query) };
    if (query.kind === "page") return { kind: query.kind, page: await queries.page(query.query) };
    if (query.kind === "inspect") return { kind: query.kind, snapshot: await inspectMemory(query.memoryId, lifetime) };
    if (query.kind === "classification") return { kind: query.kind, snapshot: await inspectBookClassification(query.bookId, lifetime) };
    if (query.kind === "graphTasks") return { kind: query.kind, tasks: await tasks.list(query.bookId) };
    if (query.kind === "graphTask") return { kind: query.kind, task: await tasks.get(query.bookId, query.taskId) };
    return { kind: query.kind, graph: await queries.bookGraph(query.bookId, query.query) };
  };
  return { queries: { ...queries, profile, profileContext,
      entities: (query?: import("@read-aware/core").EntityQuery, signal?: AbortSignal) => queryEntities(query, entitySignal(signal)),
      inspect: (id: string) => inspectMemory(id, lifetime), classification: (bookId: string) => inspectBookClassification(bookId, lifetime),
      listGraphTasks: (bookId: string) => tasks.list(bookId), getGraphTask: (bookId: string, taskId: string) => tasks.get(bookId, taskId),
      context: {
        history: (query: import("@read-aware/core").ContextBundleHistoryQuery, signal?: AbortSignal) => context.history(query, signal),
        read: (query: import("@read-aware/core").ContextBundleReadQuery, signal?: AbortSignal) => context.read(query, signal),
        export: (query: import("@read-aware/core").ContextBundleReadQuery, owner: ResourceOwner, signal?: AbortSignal) => context.export(query, owner, signal),
      } },
    commands: { mutate: (input: import("@read-aware/core").MemoryMutation) => mutateMemory(input, origin, lifetime),
      context: { capture: (selector: import("@read-aware/core").ContextBundleSelector, signal?: AbortSignal) => {
        const work = context.capture(selector, signal);
        // Publication dispatched to native drains to its real receipt even when the caller retires.
        trackCleanup?.(work.then(() => {}, () => {}));
        return work;
      } },
      updateProfile: (input: import("@read-aware/core").UserProfileChange) => {
        const work = changeUserProfile(input, origin, lifetime);
        trackCleanup?.(work.then(() => {}, () => {}));
        return work;
      },
      decideEntity: (input: import("@read-aware/core").EntityDecision, signal?: AbortSignal) => {
        const work = decideEntity(input, origin, entitySignal(signal));
        // The caller owns write errors; retirement still waits for the native transaction.
        trackCleanup?.(work.then(() => {}, () => {}));
        return work;
      },
      classify: (input: import("@read-aware/core").BookClassificationChange) => changeBookClassification(input, origin, lifetime),
      startGraphTask: (bookId: string, mode: "catch-up" | "rebuild", options?: import("@read-aware/core").BookGraphTaskOptions) => tasks.start(bookId, mode, options),
      cancelGraphTask: (bookId: string, taskId: string) => tasks.cancel(bookId, taskId),
      retryGraphTask: (bookId: string, taskId: string, options?: import("@read-aware/core").BookGraphTaskOptions) => tasks.retry(bookId, taskId, options) },
    events: { observe: (input: MemoryObservationQuery, handler: (event: MemoryObservation) => unknown) => observer.observe(input, read, handler, lifetime) } };
}
