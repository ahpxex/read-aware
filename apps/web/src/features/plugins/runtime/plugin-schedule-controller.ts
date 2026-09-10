import { AppError, errorCode, type PluginScheduleControl, type PluginSchedulePage, type PluginScheduleQuery,
  type PluginScheduleReceipt, type PluginScheduleState } from "@read-aware/core";
import { MIN_SCHEDULE_MINUTES, type PluginScheduleDeclaration } from "@read-aware/plugin-types";

export type ScheduleRecord = Pick<PluginScheduleState, "paused" | "lastStartedAt" | "lastFinishedAt" | "lastSuccessAt" | "lastOutcome" | "lastErrorCode">;
type Task = { pluginId: string; declaration: PluginScheduleDeclaration; token: object;
  run(): void | Promise<void>; record: ScheduleRecord; active: boolean; writes?: number; flight?: Promise<PluginScheduleReceipt> };
type Storage = { read(pluginId: string): Record<string, ScheduleRecord>; write(pluginId: string, records: Record<string, ScheduleRecord>): Promise<void> };
const empty = (): ScheduleRecord => ({ paused: false, lastStartedAt: null, lastFinishedAt: null, lastSuccessAt: null, lastOutcome: null, lastErrorCode: null });
const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 256;

export function isScheduleDue(lastRunIso: string | undefined, everyMinutes: number, nowMs: number): boolean {
  const last = lastRunIso ? Date.parse(lastRunIso) : NaN;
  return !Number.isFinite(last) || last > nowMs || nowMs - last >= Math.max(everyMinutes, MIN_SCHEDULE_MINUTES) * 60_000;
}

/** Cadence and manual runs share one flight; persisted attempts are not success stamps. */
export class PluginScheduleController {
  private tasks = new Map<string, Task>();
  private queues = new Map<string, Promise<unknown>>();
  private listeners = new Set<() => void>();
  constructor(private storage: Storage, private report: (error: unknown) => void, private now = Date.now) {}
  get size() { return [...this.tasks.values()].filter(task => task.active).length; }
  inspect() { return [...this.tasks].filter(([, task]) => task.active).map(([key]) => key).sort(); }
  async drainWrites(pluginId: string) {
    while (this.queues.has(pluginId)) {
      // Failed writes already reject their command; draining waits for settlement.
      await this.queues.get(pluginId)!.catch(() => {});
    }
  }
  subscribe(handler: () => void) { this.listeners.add(handler); return () => { this.listeners.delete(handler); }; }
  private changed() { for (const handler of this.listeners) { try { handler(); } catch (error) { this.report(error); } } }
  register(pluginId: string, input: PluginScheduleDeclaration, run: () => void | Promise<void>) {
    if (!validId(pluginId) || !validId(input.id) || typeof input.label !== "string" || input.label.length > 256
      || !Number.isFinite(input.everyMinutes) || input.everyMinutes <= 0 || typeof run !== "function") throw new AppError("ui/invalid-target", "Invalid schedule declaration");
    const key = `${pluginId}:${input.id}`, old = this.tasks.get(key), token = {};
    if (!old && [...this.tasks.values()].filter(task => task.pluginId === pluginId).length >= 64) throw new AppError("ui/unavailable", "Too many schedules for this plugin");
    const task: Task = old ?? { pluginId, declaration: input, token, run, record: structuredClone(this.storage.read(pluginId)[input.id] ?? empty()), active: true };
    Object.assign(task, { declaration: { ...input, everyMinutes: Math.max(input.everyMinutes, MIN_SCHEDULE_MINUTES) }, token, run, active: true });
    this.tasks.set(key, task); this.changed();
    return { dispose: () => {
      if (task.token !== token) return;
      task.active = false;
      if (!task.flight && !task.writes) this.tasks.delete(key);
      this.changed();
    } };
  }
  list(query: PluginScheduleQuery = {}): PluginSchedulePage {
    if (!query || typeof query !== "object" || Array.isArray(query) || Object.keys(query).some(key => !["pluginId", "offset", "limit"].includes(key))
      || (query.pluginId !== undefined && !validId(query.pluginId))) throw new AppError("ui/invalid-target", "Invalid schedule query");
    const offset = query.offset ?? 0, limit = query.limit ?? 50;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError("ui/invalid-target", "Invalid schedule page");
    const tasks = [...this.tasks.values()].filter(task => task.active && (!query.pluginId || task.pluginId === query.pluginId))
      .sort((a, b) => `${a.pluginId}:${a.declaration.id}`.localeCompare(`${b.pluginId}:${b.declaration.id}`));
    const page = tasks.slice(offset, offset + limit);
    return { schedules: page.map(task => this.snapshot(task)), total: tasks.length, nextOffset: offset + page.length < tasks.length ? offset + page.length : null };
  }
  observe(query: PluginScheduleQuery, handler: (page: PluginSchedulePage) => unknown) {
    const accepted = { ...query }; this.list(accepted);
    if (this.listeners.size >= 64) throw new AppError("ui/observer-limit", "Too many schedule observers");
    let disposed = false, running = false, dirty = false;
    const publish = async () => {
      dirty = true; if (running || disposed) return;
      running = true;
      try { do { dirty = false; try { await handler(this.list(accepted)); } catch (error) { this.report(error); } } while (dirty && !disposed); }
      finally { running = false; }
    };
    const off = this.subscribe(() => { void publish(); }); void publish();
    return () => { disposed = true; off(); };
  }
  async control(input: PluginScheduleControl, signal?: AbortSignal): Promise<PluginScheduleReceipt> {
    signal?.throwIfAborted();
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["pluginId", "id", "action"].includes(key))
      || !validId(input.pluginId) || !validId(input.id) || !["pause", "resume", "run"].includes(input.action)) throw new AppError("ui/invalid-target", "Invalid schedule control");
    const task = this.tasks.get(`${input.pluginId}:${input.id}`);
    if (!task?.active) throw new AppError("ui/unavailable", "Schedule is not bound");
    if (input.action === "run") return this.execute(task, signal);
    const token = task.token;
    await this.save(task, { paused: input.action === "pause" }, () => {
      signal?.throwIfAborted(); this.assertCurrent(task, token);
    });
    signal?.throwIfAborted(); this.assertCurrent(task, token);
    return { status: "completed", schedule: this.snapshot(task) };
  }
  sweep() {
    const now = this.now();
    for (const task of this.tasks.values()) {
      if (!task.active || task.flight || task.record.paused) continue;
      const stamp = task.record.lastStartedAt;
      if (isScheduleDue(stamp === null ? undefined : new Date(stamp).toISOString(), task.declaration.everyMinutes, now)) {
        void this.execute(task).catch(this.report);
      }
    }
  }
  private async execute(task: Task, signal?: AbortSignal): Promise<PluginScheduleReceipt> {
    if (task.flight) return { status: "already-running", schedule: this.snapshot(task) };
    signal?.throwIfAborted();
    const token = task.token, run = task.run;
    const work = Promise.resolve().then(async () => {
      await this.save(task, { lastStartedAt: this.now(), lastOutcome: "running", lastErrorCode: null }, () => {
        signal?.throwIfAborted(); this.assertCurrent(task, token);
      });
      try {
        signal?.throwIfAborted(); this.assertCurrent(task, token);
        await run();
        signal?.throwIfAborted(); this.assertCurrent(task, token);
      } catch (error) {
        const cancelled = signal?.aborted || !task.active || task.token !== token || errorCode(error) === "plugin/cancelled";
        const code = cancelled ? "plugin/cancelled" : errorCode(error) ?? "ipc/unknown";
        this.report(error);
        if (task.active && task.token === token) {
          await this.save(task, { lastFinishedAt: this.now(), lastOutcome: cancelled ? "cancelled" : "failed", lastErrorCode: code }, () => this.assertCurrent(task, token));
        }
        throw new AppError(code, "Plugin schedule callback did not complete");
      }
      await this.save(task, { lastFinishedAt: this.now(), lastSuccessAt: this.now(), lastOutcome: "succeeded", lastErrorCode: null }, () => this.assertCurrent(task, token));
      signal?.throwIfAborted(); this.assertCurrent(task, token);
      return { status: "completed" as const, schedule: this.snapshot(task) };
    });
    task.flight = work; this.changed();
    try { const receipt = await work; return { ...receipt, schedule: { ...receipt.schedule, running: false } }; }
    finally {
      task.flight = undefined;
      if (!task.active && !task.writes) this.tasks.delete(`${task.pluginId}:${task.declaration.id}`);
      this.changed();
    }
  }
  private save(task: Task, patch: Partial<ScheduleRecord>, guard?: () => void): Promise<void> {
    task.writes = (task.writes ?? 0) + 1;
    const previous = this.queues.get(task.pluginId) ?? Promise.resolve();
    // A failed write rejects its caller, but must not poison later control attempts.
    const work = previous.catch(() => {}).then(async () => {
      guard?.();
      const records = this.storage.read(task.pluginId), next = { ...task.record, ...patch };
      records[task.declaration.id] = next;
      await this.storage.write(task.pluginId, records);
      task.record = next; this.changed();
    });
    this.queues.set(task.pluginId, work);
    // Cleanup observes rejection only to avoid an unhandled derivative promise.
    void work.finally(() => {
      task.writes = (task.writes ?? 1) - 1;
      if (!task.active && !task.flight && !task.writes) this.tasks.delete(`${task.pluginId}:${task.declaration.id}`);
      if (this.queues.get(task.pluginId) === work) this.queues.delete(task.pluginId);
    }).catch(() => {});
    return work;
  }
  private assertCurrent(task: Task, token: object) {
    if (!task.active || task.token !== token || this.tasks.get(`${task.pluginId}:${task.declaration.id}`) !== task) throw new AppError("plugin/cancelled", "Schedule owner retired");
  }
  private snapshot(task: Task): PluginScheduleState {
    return { pluginId: task.pluginId, id: task.declaration.id, label: task.declaration.label, everyMinutes: task.declaration.everyMinutes,
      ...task.record, running: !!task.flight,
      lastOutcome: !task.flight && task.record.lastOutcome === "running" ? "interrupted" : task.record.lastOutcome };
  }
}
