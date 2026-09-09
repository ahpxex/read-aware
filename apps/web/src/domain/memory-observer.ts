import { AppError, errorCode, normalizeMemoryQuery, validateMemoryId, type MemoryObservation, type MemoryObservationQuery, type MemoryObservationResult } from "@read-aware/core";
import { normalizeBookGraphQuery } from "@read-aware/agent";

export function normalizeMemoryObservation(input: MemoryObservationQuery): MemoryObservationQuery {
  const fail = (): never => { throw new AppError("memory/invalid-query", "Invalid memory observation query"); };
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail();
  const keys = input.kind === "search" ? ["kind", "query"] : input.kind === "inspect" ? ["kind", "memoryId"] : input.kind === "graphTask" ? ["kind", "bookId", "taskId"] : input.kind === "classification" || input.kind === "graphTasks" ? ["kind", "bookId"] : ["kind", "bookId", "query"];
  if (Object.keys(input).some(key => !keys.includes(key))) return fail();
  if (input.kind === "search") return { kind: input.kind, query: normalizeMemoryQuery(input.query) };
  if (input.kind === "inspect") { validateMemoryId(input.memoryId); return { kind: input.kind, memoryId: input.memoryId }; }
  if (input.kind === "graphTask") {
    if (typeof input.bookId !== "string" || !input.bookId.trim() || input.bookId.length > 256 || typeof input.taskId !== "string" || !input.taskId.trim() || input.taskId.length > 256) return fail();
    return { kind: input.kind, bookId: input.bookId, taskId: input.taskId };
  }
  if (input.kind === "classification" || input.kind === "graphTasks") {
    if (typeof input.bookId !== "string" || !input.bookId.trim() || input.bookId.length > 256) return fail();
    return { kind: input.kind, bookId: input.bookId };
  }
  if (input.kind !== "bookGraph" || typeof input.bookId !== "string" || !input.bookId.trim() || input.bookId.length > 256) return fail();
  return { kind: input.kind, bookId: input.bookId, query: normalizeBookGraphQuery(input.query === undefined ? {} : input.query) };
}

/** Every poll reruns the authorized query. Never cache an unfiltered graph. */
export class MemoryObserver {
  private count = 0;
  constructor(private readonly deps: { schedule(work: () => void): () => void; report(error: unknown): void }) {}

  observe(input: MemoryObservationQuery, read: (query: MemoryObservationQuery) => Promise<MemoryObservationResult>,
    handler: (event: MemoryObservation) => unknown, lifetime?: AbortSignal): () => void {
    const query = normalizeMemoryObservation(input);
    if (typeof handler !== "function") throw new AppError("memory/invalid-query", "Expected an observation callback");
    if (lifetime?.aborted) throw new AppError("memory/cancelled", "Memory observer owner retired");
    if (this.count >= 64) throw new AppError("memory/observer-limit", "Too many memory observers");
    ++this.count;
    let disposed = false, revision = 0, settled: string | undefined, cancelTimer: (() => void) | undefined;
    const dispose = () => {
      if (disposed) return;
      disposed = true; --this.count; cancelTimer?.(); cancelTimer = undefined;
      lifetime?.removeEventListener("abort", dispose);
    };
    const poll = async () => {
      let value: Omit<Extract<MemoryObservation, { status: "ready" }>, "revision"> | Omit<Extract<MemoryObservation, { status: "error" }>, "revision">;
      try { value = { status: "ready", result: await read(structuredClone(query)) }; }
      catch (error) { this.deps.report(error); value = { status: "error", errorCode: errorCode(error) ?? "memory/observation-failed" }; }
      if (disposed) return;
      // Compare before invoking untrusted callbacks; callback mutation cannot
      // change the next query or falsely acknowledge a failed delivery.
      const key = JSON.stringify(value);
      if (key !== settled) {
        try { await handler({ ...structuredClone(value), revision: ++revision }); settled = key; }
        catch (error) { this.deps.report(error); }
      }
      if (!disposed) cancelTimer = this.deps.schedule(() => { cancelTimer = undefined; void poll(); });
    };
    lifetime?.addEventListener("abort", dispose, { once: true });
    void poll();
    return dispose;
  }
}
