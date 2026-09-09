import { AppError, normalizeWorkspaceQuery, normalizeWorkspaceTarget, type WorkspaceQuery, type WorkspaceReceipt, type WorkspaceSnapshot, type WorkspaceTarget } from "@read-aware/core";
import { createLogger } from "../platform/logger";

export type WorkspaceView = Omit<WorkspaceSnapshot, "revision" | "selection"> & { selection: { active: boolean; bookIds: string[] } };
type Adapter = {
  prepare(target: WorkspaceTarget, signal: AbortSignal): Promise<void>;
  apply(target: WorkspaceTarget, signal: AbortSignal, allowReaderClose: boolean): Promise<void>;
  requestCommit(token: number): void;
};
type Binding = { adapter: Adapter; view: WorkspaceView; token: number; acknowledgements: Map<string, number> };
type Pending = { binding: Binding; token: number; target: WorkspaceTarget; ready: boolean; controller: AbortController;
  resolve(receipt: WorkspaceReceipt): void; reject(error: unknown): void; cleanup(): void };

function matches(view: WorkspaceView, target: WorkspaceTarget): boolean {
  if (target.surface === "settings") return view.settings.open && view.settings.section === target.section && !view.search.open;
  if (target.surface === "search") return view.search.open && view.search.query === target.query && !view.settings.open;
  if (view.surface !== target.surface || view.settings.open || view.search.open) return false;
  if (target.surface !== "shelf") return true;
  if (view.collectionId !== target.collectionId) return false;
  const selection = target.selection ?? { active: false, bookIds: [] };
  return selection.active === view.selection.active && selection.bookIds.length === view.selection.bookIds.length
    && selection.bookIds.every(id => view.selection.bookIds.includes(id));
}

/** One presentation owner for native UI, model tools and permission-gated Workers. */
export class WorkspaceService {
  private binding?: Binding;
  private pending?: Pending;
  private revision = 0;
  private token = 0;
  private observers = new Set<() => void>();

  constructor(private readonly report: (error: unknown) => void, private readonly deadlineMs = 10_000) {}

  snapshot(query?: WorkspaceQuery): WorkspaceSnapshot {
    const accepted = normalizeWorkspaceQuery(query);
    if (!this.binding) throw new AppError("ui/unavailable", "Workspace is not attached");
    const { selection, ...view } = this.binding.view;
    const ids = [...new Set(selection.bookIds)].sort();
    const after = accepted.selectionAfter;
    const remaining = after === undefined ? ids : ids.filter(id => id > after);
    const page = remaining.slice(0, accepted.limit);
    return { ...structuredClone(view), revision: this.revision, selection: { active: selection.active,
      total: ids.length, bookIds: page, nextCursor: remaining.length > page.length ? page.at(-1)! : null } };
  }

  observe(query: WorkspaceQuery, handler: (value: WorkspaceSnapshot | null) => unknown): () => void {
    const accepted = normalizeWorkspaceQuery(query);
    if (this.observers.size >= 64) throw new AppError("ui/observer-limit", "Too many workspace observers");
    let disposed = false, running = false, dirty = false;
    const deliver = async () => {
      if (disposed) return;
      dirty = true;
      if (running) return;
      running = true;
      try {
        do {
          dirty = false;
          try { await handler(this.binding ? this.snapshot(accepted) : null); } catch (error) { this.report(error); }
        } while (dirty && !disposed);
      } finally { running = false; }
    };
    const notify = () => { void deliver(); };
    this.observers.add(notify); notify();
    return () => { disposed = true; this.observers.delete(notify); };
  }

  bind(adapter: Adapter, initial: WorkspaceView) {
    this.cancel(new AppError("ui/superseded", "Workspace owner changed"));
    const binding: Binding = { adapter, view: structuredClone(initial), token: 0, acknowledgements: new Map() };
    this.binding = binding; this.changed();
    return {
      publish: (view: WorkspaceView, token: number) => {
        if (this.binding !== binding) return;
        const changed = JSON.stringify(view) !== JSON.stringify(binding.view);
        binding.view = structuredClone(view); binding.token = token;
        if (changed) this.revision++;
        this.complete();
        if (changed) this.notify();
      },
      dispose: () => {
        if (this.binding !== binding) return;
        this.binding = undefined; this.cancel(new AppError("ui/superseded", "Workspace owner retired")); this.changed();
      },
    };
  }

  /** Called by the destination's layout effect, inside its Suspense/error boundary. */
  acknowledge(surface: string, token: number): void {
    this.binding?.acknowledgements.set(surface, token); this.complete();
  }

  navigate(input: WorkspaceTarget, expectedRevision?: number, signal?: AbortSignal, allowReaderClose = false): Promise<WorkspaceReceipt> {
    let target: WorkspaceTarget;
    try {
      signal?.throwIfAborted(); target = normalizeWorkspaceTarget(input);
      if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) throw new AppError("ui/invalid-target", "Invalid workspace revision");
      if (expectedRevision !== undefined && expectedRevision !== this.revision) throw new AppError("ui/superseded", "Workspace revision changed");
    } catch (error) { return Promise.reject(error); }
    const binding = this.binding;
    if (!binding) return Promise.reject(new AppError("ui/unavailable", "Workspace is not attached"));
    this.cancel(new AppError("ui/superseded", "A newer workspace intent replaced this request"));
    const revision = this.revision;
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const abort = () => { if (this.pending?.controller === controller) this.cancel(signal?.reason ?? new AppError("ui/timeout", "Workspace did not commit")); };
      const timer = setTimeout(abort, this.deadlineMs);
      const pending: Pending = { binding, token: ++this.token, target, controller, ready: false, resolve, reject,
        cleanup: () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); } };
      this.pending = pending; signal?.addEventListener("abort", abort, { once: true });
      void (async () => {
        await binding.adapter.prepare(target, controller.signal);
        controller.signal.throwIfAborted();
        // Async lookups must not overwrite a newer native UI choice.
        if (revision !== this.revision) throw new AppError("ui/superseded", "Workspace changed during target validation");
        await binding.adapter.apply(target, controller.signal, allowReaderClose);
        controller.signal.throwIfAborted();
        if (this.pending !== pending || this.binding !== binding) return;
        pending.ready = true; binding.adapter.requestCommit(pending.token);
      })().catch(error => { if (this.pending === pending) this.cancel(error); });
    });
  }

  private complete(): void {
    const pending = this.pending, binding = this.binding;
    if (!pending?.ready || binding !== pending.binding || binding.token !== pending.token
      || binding.acknowledgements.get(pending.target.surface) !== pending.token || !matches(binding.view, pending.target)) return;
    const receipt: WorkspaceReceipt = { status: "completed", snapshot: this.snapshot() };
    this.pending = undefined; pending.cleanup(); pending.resolve(receipt);
  }
  private cancel(error: unknown): void {
    const pending = this.pending; this.pending = undefined;
    if (pending) { pending.cleanup(); pending.controller.abort(error); pending.reject(error); }
  }
  private notify(): void { for (const notify of [...this.observers]) notify(); }
  private changed(): void { this.revision++; this.notify(); }
}

const log = createLogger("workspace");
export const workspace = new WorkspaceService(error => log.warn("Workspace observer failed", error));
