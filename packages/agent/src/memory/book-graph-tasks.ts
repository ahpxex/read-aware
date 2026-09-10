import { AppError, errorCode, validateClassificationBookId, normalizeBookGraphTaskOptions, type BookGraphTaskOptions, type BookGraphTaskPort, type BookGraphTaskSnapshot, type DigestReport } from "@read-aware/core";

export interface BookGraphTaskExecution {
  bookId: string;
  rebuild: boolean;
  maxChapters: number;
  targets?: readonly number[];
  signal: AbortSignal;
  onStarted(): void;
  onPlan(chapters: number[]): void;
  onChapterAttempted(chapter: number): void;
  onChapterCommitted(chapter: number): void;
  onReport(report: DigestReport): void;
}
type Task = { state: BookGraphTaskSnapshot; controller: AbortController; pending?: Set<number>; detach(): void };
const active = (task: Task) => ["queued", "running", "cancelling"].includes(task.state.status);
const cancelled = () => new AppError("memory/cancelled", "Graph task cancelled");

/** Actor-generation ownership; execution and book serialization belong to the host. */
export class BookGraphTaskOwner implements BookGraphTaskPort {
  private readonly tasks = new Map<string, Task>();
  private stopped = false;
  constructor(private readonly execute: (input: BookGraphTaskExecution) => Promise<DigestReport>,
    private readonly warn: (message: string, error: unknown) => void, lifetime?: AbortSignal) {
    if (lifetime?.aborted) this.stopped = true;
    else lifetime?.addEventListener("abort", () => this.dispose(), { once: true });
  }
  private assertLive() { if (this.stopped) throw cancelled(); }
  private lookup(bookId: string, taskId: string) {
    this.assertLive(); validateClassificationBookId(bookId);
    const task = this.tasks.get(taskId);
    if (!task || task.state.bookId !== bookId) throw new AppError("memory/task-not-found", "No task belongs to this actor and book");
    return task;
  }
  private update(task: Task, change: Partial<BookGraphTaskSnapshot>) {
    if (!active(task)) return;
    task.state = { ...task.state, ...change, revision: task.state.revision + 1, updatedAt: new Date().toISOString() };
  }
  async start(bookId: string, mode: "catch-up" | "rebuild", options?: BookGraphTaskOptions, signal?: AbortSignal) {
    return this.create(bookId, mode, normalizeBookGraphTaskOptions(options), undefined, undefined, signal);
  }
  private create(bookId: string, mode: "catch-up" | "rebuild", options: BookGraphTaskOptions, retryOf?: string, targets?: number[], signal?: AbortSignal): BookGraphTaskSnapshot {
    this.assertLive(); validateClassificationBookId(bookId);
    if (mode !== "catch-up" && mode !== "rebuild") throw new AppError("memory/invalid-input", "Invalid graph task mode");
    if (signal?.aborted) throw cancelled();
    if ([...this.tasks.values()].filter(active).length >= 16) throw new AppError("memory/task-limit", "Too many active graph requests for this actor", { retryable: true });
    for (const [id, task] of this.tasks) {
      if (this.tasks.size < 64) break;
      if (!active(task)) this.tasks.delete(id);
    }
    const now = new Date().toISOString(), controller = new AbortController();
    const abort = () => this.abort(task);
    const task: Task = { controller, pending: targets && new Set(targets), detach: () => signal?.removeEventListener("abort", abort), state: {
      taskId: crypto.randomUUID(), bookId, mode, maxChapters: options.maxChapters, ...(retryOf ? { retryOf } : {}), revision: 0, status: "queued", createdAt: now, updatedAt: now,
    } };
    this.tasks.set(task.state.taskId, task);
    signal?.addEventListener("abort", abort, { once: true });
    const initial = structuredClone(task.state);
    void this.run(task, targets);
    return initial;
  }
  private async run(task: Task, targets?: number[]) {
    try {
      const report = await this.execute({ bookId: task.state.bookId, rebuild: task.state.mode === "rebuild", maxChapters: task.state.maxChapters, targets,
        signal: task.controller.signal,
        onStarted: () => { if (!task.controller.signal.aborted) this.update(task, { status: "running" }); },
        onPlan: chapters => { if (active(task)) task.pending = new Set(chapters); },
        onChapterAttempted: chapter => {
          if (active(task) && task.pending?.delete(chapter)) task.pending.add(chapter);
        },
        onChapterCommitted: chapter => { if (active(task)) task.pending?.delete(chapter); },
        onReport: report => { this.update(task, { report: structuredClone(report) }); },
      });
      const finalReport = structuredClone(report);
      this.update(task, task.controller.signal.aborted ? { status: "cancelled", errorCode: "memory/cancelled", report: finalReport }
        : { status: report.status === "complete" ? "completed" : report.status, report: finalReport });
    } catch (error) {
      const code = task.controller.signal.aborted ? "memory/cancelled" : errorCode(error) ?? "ai/unknown";
      if (!task.controller.signal.aborted) this.warn("Graph task failed", error);
      this.update(task, { status: task.controller.signal.aborted ? "cancelled" : "failed", errorCode: code });
    } finally { task.detach(); }
  }
  async get(bookId: string, taskId: string) { return structuredClone(this.lookup(bookId, taskId).state); }
  async list(bookId: string) {
    this.assertLive(); validateClassificationBookId(bookId);
    return [...this.tasks.values()].filter(task => task.state.bookId === bookId).map(task => structuredClone(task.state));
  }
  private abort(task: Task) {
    if (!active(task) || task.controller.signal.aborted) return;
    this.update(task, { status: "cancelling" });
    task.controller.abort(cancelled());
  }
  async cancel(bookId: string, taskId: string) {
    const task = this.lookup(bookId, taskId); this.abort(task); return structuredClone(task.state);
  }
  async retry(bookId: string, taskId: string, options?: BookGraphTaskOptions, signal?: AbortSignal) {
    const task = this.lookup(bookId, taskId);
    if (active(task) || task.state.status === "completed") throw new AppError("memory/conflict", "Only unfinished terminal tasks can be retried");
    // A failed rebuild can leave a valid OLD digest. Retain its target instead of treating it as repaired.
    return this.create(bookId, task.state.mode, normalizeBookGraphTaskOptions(options, task.state.maxChapters), taskId, task.pending ? [...task.pending] : undefined, signal);
  }
  dispose() {
    if (this.stopped) return;
    this.stopped = true;
    for (const task of this.tasks.values()) { task.detach(); this.abort(task); }
    this.tasks.clear();
  }
}
