import { observeSnapshot } from "../domain/snapshot-observation";
import { causalActor, copyEventCause, eventCause, stampEventCause, type DomainActor } from "../platform/domain-actor";
import {
  AppError,
  normalizeWorkspaceQuery,
  normalizeWorkspaceTarget,
  type WorkspaceQuery,
  type WorkspaceReceipt,
  type WorkspaceSnapshot,
  type WorkspaceTarget,
} from "@read-aware/core";
import { createLogger } from "../platform/logger";
import { PendingIntentSlot } from "../platform/pending-intent";

export type WorkspaceView = Omit<WorkspaceSnapshot, "revision" | "selection"> & {
  selection: { active: boolean; bookIds: string[] };
};
type Adapter = {
  prepare(target: WorkspaceTarget, signal: AbortSignal): Promise<void>;
  apply(target: WorkspaceTarget, signal: AbortSignal, allowReaderClose: boolean, source: DomainActor): Promise<void>;
  requestCommit(token: number): void;
};
type Binding = { adapter: Adapter; view: WorkspaceView; token: number; acknowledgements: Map<string, number> };
type Request = {
  binding: Binding;
  target: WorkspaceTarget;
  /** The adapter applied it and asked for the matching commit. */
  ready: boolean;
  project?: (view: WorkspaceView) => WorkspaceView;
};

function matches(view: WorkspaceView, target: WorkspaceTarget): boolean {
  if (target.surface === "settings")
    return view.settings.open && view.settings.section === target.section && !view.search.open;
  if (target.surface === "search") return view.search.open && view.search.query === target.query && !view.settings.open;
  if (view.surface !== target.surface || view.settings.open || view.search.open) return false;
  if (target.surface !== "shelf") return true;
  if (view.collectionId !== target.collectionId) return false;
  const selection = target.selection ?? { active: false, bookIds: [] };
  return (
    selection.active === view.selection.active &&
    selection.bookIds.length === view.selection.bookIds.length &&
    selection.bookIds.every((id) => view.selection.bookIds.includes(id))
  );
}

/** One presentation owner for native UI, model tools and permission-gated Workers. */
export class WorkspaceService {
  private binding?: Binding;
  private readonly pending: PendingIntentSlot<Request, WorkspaceReceipt>;
  private revision = 0;
  private observers = new Set<(source: object) => void>();

  constructor(
    private readonly report: (error: unknown) => void,
    deadlineMs = 10_000,
  ) {
    this.pending = new PendingIntentSlot({
      deadlineMs,
      timeout: () => new AppError("ui/timeout", "Workspace did not commit"),
      superseded: () => new AppError("ui/superseded", "A newer workspace intent replaced this request"),
    });
  }

  snapshot(query?: WorkspaceQuery, project?: (view: WorkspaceView) => WorkspaceView): WorkspaceSnapshot {
    const accepted = normalizeWorkspaceQuery(query);
    if (!this.binding) throw new AppError("ui/unavailable", "Workspace is not attached");
    // Apply actor disclosure before counting, sorting or paging selections.
    const { selection, ...view } = project ? project(structuredClone(this.binding.view)) : this.binding.view;
    const ids = [...new Set(selection.bookIds)].sort();
    const after = accepted.selectionAfter;
    const remaining = after === undefined ? ids : ids.filter((id) => id > after);
    const page = remaining.slice(0, accepted.limit);
    return copyEventCause(this.binding.view, {
      ...structuredClone(view),
      revision: this.revision,
      selection: {
        active: selection.active,
        total: ids.length,
        bookIds: page,
        nextCursor: remaining.length > page.length ? page.at(-1)! : null,
      },
    });
  }

  observe(
    query: WorkspaceQuery,
    handler: (value: WorkspaceSnapshot | null, source: object) => unknown,
    project?: (view: WorkspaceView) => WorkspaceView,
    origin: DomainActor = "system",
  ): () => void {
    const accepted = normalizeWorkspaceQuery(query);
    if (this.observers.size >= 64) throw new AppError("ui/observer-limit", "Too many workspace observers");
    return observeSnapshot(
      () => (this.binding ? this.snapshot(accepted, project) : null),
      (notify) => {
        this.observers.add(notify);
        return () => {
          this.observers.delete(notify);
        };
      },
      handler,
      this.report,
      origin,
    );
  }

  bind(adapter: Adapter, initial: WorkspaceView) {
    this.cancel(new AppError("ui/superseded", "Workspace owner changed"));
    const binding: Binding = {
      adapter,
      view: eventCause(initial)
        ? copyEventCause(initial, structuredClone(initial))
        : stampEventCause(structuredClone(initial), "system"),
      token: 0,
      acknowledgements: new Map(),
    };
    this.binding = binding;
    this.changed(binding.view);
    return {
      publish: (view: WorkspaceView, token: number) => {
        if (this.binding !== binding) return;
        const changed = JSON.stringify(view) !== JSON.stringify(binding.view);
        binding.view = changed
          ? eventCause(view)
            ? copyEventCause(view, structuredClone(view))
            : stampEventCause(structuredClone(view), "system")
          : copyEventCause(binding.view, structuredClone(view));
        binding.token = token;
        if (changed) this.revision++;
        this.complete();
        if (changed) this.notify(binding.view);
      },
      dispose: (origin: DomainActor = "system") => {
        if (this.binding !== binding) return;
        this.binding = undefined;
        this.cancel(new AppError("ui/superseded", "Workspace owner retired"));
        this.changed(stampEventCause({}, causalActor(origin)));
      },
    };
  }

  /** Called by the destination's layout effect, inside its Suspense/error boundary. */
  acknowledge(surface: string, token: number): void {
    this.binding?.acknowledgements.set(surface, token);
    this.complete();
  }

  navigate(
    input: WorkspaceTarget,
    expectedRevision?: number,
    signal?: AbortSignal,
    allowReaderClose = false,
    project?: (view: WorkspaceView) => WorkspaceView,
    origin: DomainActor = "user",
  ): Promise<WorkspaceReceipt> {
    let target: WorkspaceTarget, source: DomainActor;
    try {
      source = causalActor(origin);
      signal?.throwIfAborted();
      target = normalizeWorkspaceTarget(input);
      if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0))
        throw new AppError("ui/invalid-target", "Invalid workspace revision");
      if (expectedRevision !== undefined && expectedRevision !== this.revision)
        throw new AppError("ui/superseded", "Workspace revision changed");
    } catch (error) {
      return Promise.reject(error);
    }
    const binding = this.binding;
    if (!binding) return Promise.reject(new AppError("ui/unavailable", "Workspace is not attached"));
    const revision = this.revision;
    const request: Request = { binding, target, ready: false, project };
    const { intent, settled } = this.pending.begin(request, signal);
    void (async () => {
      await binding.adapter.prepare(target, intent.signal);
      intent.signal.throwIfAborted();
      // Async lookups must not overwrite a newer native UI choice.
      if (revision !== this.revision) throw new AppError("ui/superseded", "Workspace changed during target validation");
      await binding.adapter.apply(target, intent.signal, allowReaderClose, source);
      intent.signal.throwIfAborted();
      if (!this.pending.holds(intent) || this.binding !== binding) return;
      request.ready = true;
      binding.adapter.requestCommit(intent.token);
    })().catch((error) => {
      if (this.pending.holds(intent)) this.cancel(error);
    });
    return settled;
  }

  private complete(): void {
    const intent = this.pending.current,
      request = intent?.payload,
      binding = this.binding;
    if (
      !intent ||
      !request?.ready ||
      binding !== request.binding ||
      binding.token !== intent.token ||
      binding.acknowledgements.get(request.target.surface) !== intent.token ||
      !matches(binding.view, request.target)
    )
      return;
    this.pending.confirm(intent, { status: "completed", snapshot: this.snapshot(undefined, request.project) });
  }
  private cancel(error: unknown): void {
    this.pending.cancel(error);
  }
  private notify(source: object): void {
    for (const notify of [...this.observers]) notify(source);
  }
  private changed(source: object): void {
    this.revision++;
    this.notify(source);
  }
}

const log = createLogger("workspace");
export const workspace = new WorkspaceService((error) => log.warn("Workspace observer failed", error));
