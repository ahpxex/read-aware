import { causalActor, stampEventCause, type DomainActor } from "../platform/domain-actor";
import { observeSnapshot } from "../domain/snapshot-observation";
import {
  AppError,
  type ReaderPanel,
  type ReaderPanelReceipt,
  type ReaderPanelsSnapshot,
  type ReaderPanelsView,
  type ReadingSessionGuard,
} from "@read-aware/core";
import type { ReadingSessionController } from "../domain/reading-session-controller";
import { readingRuntime } from "../domain/reading-runtime";
import { watchReaderSession } from "../domain/reader-session-watch";
import { createLogger } from "../platform/logger";
import { PendingIntentSlot } from "../platform/pending-intent";
import { assertReaderPanelWidth, type ResizableReaderPanel } from "@read-aware/core";

type Adapter = {
  apply(panel: ReaderPanel, open: boolean, signal: AbortSignal, origin: DomainActor): Promise<void>;
  applyWidth(panel: ResizableReaderPanel, width: number, signal: AbortSignal, origin: DomainActor): Promise<void>;
  requestCommit(token: number, origin: DomainActor): void;
};
type Binding = {
  sessionId: string;
  bookId: string;
  adapter: Adapter;
  view: ReaderPanelsView;
  release(origin?: DomainActor): void;
};
type Operation =
  | { panel: ReaderPanel; open: boolean; width?: never }
  | { panel: ResizableReaderPanel; width: number; open?: never };
type Request = Operation & {
  binding: Binding;
  /** The adapter applied it and asked for the matching commit. */
  ready: boolean;
  origin: DomainActor;
};
const panels: readonly ReaderPanel[] = ["toc", "annotations", "appearance", "chat"];

/** S3 presentation service. The reading domain retains session and chrome ownership. */
export class ReaderPanelsService {
  private binding?: Binding;
  private readonly pending: PendingIntentSlot<Request, ReaderPanelReceipt>;
  private revision = 0;
  private origin: DomainActor = causalActor("system");
  private observers = new Set<(source: object) => void>();

  constructor(
    private readonly reading: Pick<ReadingSessionController, "snapshot" | "observe" | "setControls">,
    private readonly report: (error: unknown) => void,
    deadlineMs = 10_000,
  ) {
    this.pending = new PendingIntentSlot({
      deadlineMs,
      timeout: () => new AppError("reader/timeout", "Reader panel did not commit"),
      superseded: () => new AppError("reader/superseded", "A newer panel intent replaced this request"),
    });
  }

  snapshot(): ReaderPanelsSnapshot | null {
    const binding = this.binding;
    const current = this.reading.snapshot();
    if (!binding || current.status !== "ready" || current.sessionId !== binding.sessionId) return null;
    return stampEventCause(
      {
        ...structuredClone(binding.view),
        sessionId: binding.sessionId,
        bookId: binding.bookId,
        revision: this.revision,
      },
      this.origin,
    );
  }

  observe(handler: (state: ReaderPanelsSnapshot | null, source: object) => unknown, origin?: DomainActor): () => void {
    if (typeof handler !== "function") throw new AppError("reader/invalid-target", "Expected panel observer");
    if (this.observers.size >= 64) throw new AppError("ui/observer-limit", "Too many panel observers");
    return observeSnapshot(
      () => this.snapshot(),
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

  bind(
    sessionId: string,
    bookId: string,
    adapter: Adapter,
    initial: ReaderPanelsView,
    origin: DomainActor = "system",
  ): {
    publish(view: ReaderPanelsView, token: number, origin?: DomainActor): void;
    dispose(origin?: DomainActor): void;
  } {
    this.checkGuard({ sessionId, bookId });
    origin = causalActor(origin);
    this.binding?.release(origin);
    const binding: Binding = { sessionId, bookId, adapter, view: structuredClone(initial), release: () => {} };
    this.binding = binding;
    const dispose = (origin: DomainActor = this.origin) => {
      if (this.binding !== binding) return;
      this.binding = undefined;
      this.cancel(new AppError("reader/superseded", "Reader panels session ended"));
      unobserve();
      this.changed(origin);
    };
    // The initial guard already proved identity.
    const unobserve = watchReaderSession(this.reading, { sessionId, bookId }, dispose);
    binding.release = dispose;
    this.changed(origin);
    return {
      dispose,
      publish: (view, token, origin = "system") => {
        if (this.binding !== binding) return;
        const hidden = binding.view.controlsVisible && !view.controlsVisible;
        const changed = JSON.stringify(binding.view) !== JSON.stringify(view);
        binding.view = structuredClone(view);
        if (hidden) this.cancel(new AppError("reader/superseded", "Reader controls were hidden"));
        const intent = this.pending.current;
        const request = intent?.payload;
        if (intent && request?.binding === binding && request.ready && intent.token === token) {
          const state = view.panels[request.panel];
          if (
            request.width !== undefined
              ? view.sizes[request.panel as ResizableReaderPanel] === request.width
              : state.open === request.open && (!request.open || state.visible)
          )
            // Settle with this commit before an observer can start another operation.
            this.pending.confirm(intent, {
              status: "completed",
              panel: request.panel,
              snapshot: stampEventCause(
                {
                  ...structuredClone(view),
                  sessionId,
                  bookId,
                  revision: this.revision + (changed ? 1 : 0),
                },
                request.origin,
              ),
            });
          else this.cancel(new AppError("reader/superseded", "Reader panel state changed before completion"));
        }
        if (changed) this.changed(origin);
      },
    };
  }

  setPanel(
    panel: ReaderPanel,
    open: boolean,
    signal?: AbortSignal,
    guard?: ReadingSessionGuard,
    origin: DomainActor = "user",
  ): Promise<ReaderPanelReceipt> {
    if (!panels.includes(panel) || typeof open !== "boolean")
      return Promise.reject(new AppError("reader/invalid-target", "Invalid reader panel operation"));
    return this.dispatch({ panel, open }, signal, guard, origin);
  }

  setWidth(
    panel: ResizableReaderPanel,
    width: number,
    signal?: AbortSignal,
    guard?: ReadingSessionGuard,
    origin: DomainActor = "user",
  ): Promise<ReaderPanelReceipt> {
    try {
      assertReaderPanelWidth(panel, width);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.dispatch({ panel, width }, signal, guard, origin);
  }

  private dispatch(
    operation: Operation,
    signal?: AbortSignal,
    guard?: ReadingSessionGuard,
    origin: DomainActor = "user",
  ): Promise<ReaderPanelReceipt> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    try {
      this.checkGuard(guard);
    } catch (error) {
      return Promise.reject(error);
    }
    const binding = this.binding;
    if (!binding || !this.snapshot())
      return Promise.reject(new AppError("reader/unavailable", "Reader panels are not attached"));
    origin = causalActor(origin);
    const request: Request = { ...operation, binding, origin, ready: false };
    const { intent, settled } = this.pending.begin(request, signal);
    void (async () => {
      const { signal: live } = intent;
      if (operation.open)
        await this.reading.setControls(true, live, { sessionId: binding.sessionId, bookId: binding.bookId }, origin);
      live.throwIfAborted();
      if (operation.width !== undefined)
        await binding.adapter.applyWidth(operation.panel, operation.width, live, origin);
      else await binding.adapter.apply(operation.panel, operation.open, live, origin);
      live.throwIfAborted();
      if (!this.pending.holds(intent) || this.binding !== binding) return;
      request.ready = true;
      binding.adapter.requestCommit(intent.token, origin);
    })().catch((error) => {
      if (this.pending.holds(intent)) this.cancel(error);
    });
    return settled;
  }

  private checkGuard(guard?: ReadingSessionGuard): void {
    const current = this.reading.snapshot();
    if (
      guard !== undefined &&
      (!guard ||
        typeof guard !== "object" ||
        (guard.sessionId !== undefined && typeof guard.sessionId !== "string") ||
        (guard.bookId !== undefined && typeof guard.bookId !== "string"))
    )
      throw new AppError("reader/invalid-target", "Invalid session guard");
    if (
      (guard?.sessionId !== undefined && guard.sessionId !== current.sessionId) ||
      (guard?.bookId !== undefined && guard.bookId !== current.bookId)
    )
      throw new AppError("reader/superseded", "Reader panels target changed");
    if (!current.sessionId || current.status !== "ready")
      throw new AppError("reader/unavailable", "Reader panels require a ready reader");
  }
  private cancel(error: unknown): void {
    this.pending.cancel(error);
  }
  private changed(origin: DomainActor): void {
    this.origin = causalActor(origin);
    const source = stampEventCause({}, this.origin),
      revision = ++this.revision;
    for (const handler of [...this.observers]) {
      if (revision !== this.revision) break;
      handler(source);
    }
  }
}

const log = createLogger("reader-panels");
export const readerPanels = new ReaderPanelsService(readingRuntime, (error) =>
  log.warn("Panel observer failed", error),
);
