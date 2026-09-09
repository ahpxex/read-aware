import { AppError, errorCode, type BookTextPrepareOptions, type BookTextTaskSnapshot } from "@read-aware/core";
import type { BookTextRepository } from "./book-text-repository";

type Listener = (state: BookTextTaskSnapshot) => void | Promise<void>;
type Observer = { send(state: BookTextTaskSnapshot): void; stop(): void };
type Task = { state: BookTextTaskSnapshot; controller: AbortController; observers: Set<Observer> };
const active = (state: BookTextTaskSnapshot) => state.status === "queued" || state.status === "running";
const cancelled = () => new AppError("library/text-cancelled", "This text preparation request was cancelled");

/** Per-actor-generation task handles. Each request leases the shared repository work. */
export class BookTextTaskOwner {
  private readonly tasks = new Map<string, Task>();
  private stopped = false;
  constructor(private readonly repository: Pick<BookTextRepository, "snapshot" | "prepare">,
    private readonly warn: (message: string, error: unknown) => void,
    lifetime?: AbortSignal) {
    if (lifetime?.aborted) this.dispose();
    else lifetime?.addEventListener("abort", () => this.dispose(), { once: true });
  }

  private assertLive() { if (this.stopped) throw cancelled(); }
  private lookup(bookId: string, taskId: string): Task {
    this.assertLive();
    const task = this.tasks.get(taskId);
    if (!task || task.state.bookId !== bookId) throw new AppError("library/text-task-not-found", "No task belongs to this actor and book");
    return task;
  }
  private publish(task: Task, change: Partial<Pick<BookTextTaskSnapshot, "status" | "textState" | "errorCode">>) {
    if (!active(task.state)) return;
    task.state = { ...task.state, ...change, revision: task.state.revision + 1, updatedAt: new Date().toISOString() };
    for (const observer of task.observers) observer.send(task.state);
  }

  async start(bookId: string, options: BookTextPrepareOptions = {}): Promise<BookTextTaskSnapshot> {
    this.assertLive();
    if (!options || typeof options !== "object" || Array.isArray(options)
      || Object.keys(options).some(key => key !== "rebuild") || options.rebuild !== undefined && typeof options.rebuild !== "boolean") {
      throw new AppError("library/invalid-input", "Invalid text preparation options");
    }
    const request = { rebuild: options.rebuild };
    const state = await this.repository.snapshot(bookId);
    this.assertLive();
    if ([...this.tasks.values()].filter(task => active(task.state)).length >= 16) throw new AppError("library/text-task-limit", "Too many active text requests for this actor");
    // Retain at most 64 handles. Eviction closes observers of oldest terminal requests.
    for (const [id, task] of this.tasks) {
      if (this.tasks.size < 64) break;
      if (!active(task.state)) { for (const observer of task.observers) observer.stop(); this.tasks.delete(id); }
    }
    const now = new Date().toISOString();
    const task: Task = { controller: new AbortController(), observers: new Set(), state: {
      taskId: crypto.randomUUID(), bookId, mode: request.rebuild ? "rebuild" : "prepare", revision: 0,
      status: "queued", createdAt: now, updatedAt: now, textState: state,
    } };
    this.tasks.set(task.state.taskId, task);
    void this.run(task, request);
    return structuredClone(task.state);
  }

  private async run(task: Task, options: BookTextPrepareOptions): Promise<void> {
    this.publish(task, { status: "running" });
    try {
      const textState = await this.repository.prepare(task.state.bookId, { ...options, signal: task.controller.signal,
        progress: textState => this.publish(task, { textState }) });
      this.publish(task, { status: "completed", textState });
    } catch (error) {
      if (task.controller.signal.aborted || !active(task.state)) return;
      this.warn("Book text request failed", error);
      // A failed query remains a failure code; it must not replace known progress with an empty state.
      let textState = task.state.textState;
      try { textState = await this.repository.snapshot(task.state.bookId); }
      catch (readError) { this.warn("Failed to refresh text state after a request failure", readError); }
      this.publish(task, { status: "failed", errorCode: errorCode(error) ?? "library/text-extraction-failed", textState });
    }
  }

  get(bookId: string, taskId: string): BookTextTaskSnapshot { return structuredClone(this.lookup(bookId, taskId).state); }
  list(bookId: string): BookTextTaskSnapshot[] {
    this.assertLive();
    if (typeof bookId !== "string" || !bookId.trim()) throw new AppError("library/invalid-input", "A book ID is required");
    return [...this.tasks.values()].filter(task => task.state.bookId === bookId).map(task => structuredClone(task.state));
  }
  cancel(bookId: string, taskId: string): BookTextTaskSnapshot {
    const task = this.lookup(bookId, taskId);
    if (active(task.state)) {
      this.publish(task, { status: "cancelled", errorCode: "library/text-cancelled" });
      task.controller.abort(cancelled());
    }
    return structuredClone(task.state);
  }

  /** Immediate snapshot plus monotonic revisions; slow consumers coalesce to the latest snapshot. */
  observe(bookId: string, taskId: string, listener: Listener): () => void {
    const task = this.lookup(bookId, taskId);
    if (task.observers.size >= 16) throw new AppError("library/text-task-limit", "Too many observers of this task");
    if (typeof listener !== "function") throw new AppError("library/invalid-input", "A task observer is required");
    let stopped = false, delivering = false;
    let latest: BookTextTaskSnapshot | undefined;
    const observer: Observer = {
      send: state => {
        if (stopped) return;
        latest = structuredClone(state);
        if (!delivering) void deliver();
      },
      stop: () => { stopped = true; latest = undefined; task.observers.delete(observer); },
    };
    const deliver = async () => {
      delivering = true;
      try {
        while (!stopped && latest) {
          const value = latest; latest = undefined;
          try { await listener(value); }
          catch (error) { this.warn("Text task observer failed", error); }
        }
      } finally { delivering = false; }
    };
    task.observers.add(observer); observer.send(task.state);
    return observer.stop;
  }

  dispose(): void {
    if (this.stopped) return;
    // Stop delivery before aborting requests; no retired actor receives cancellation callbacks.
    for (const task of this.tasks.values()) {
      for (const observer of task.observers) observer.stop();
      if (active(task.state)) this.cancel(task.state.bookId, task.state.taskId);
    }
    this.stopped = true; this.tasks.clear();
  }
}
