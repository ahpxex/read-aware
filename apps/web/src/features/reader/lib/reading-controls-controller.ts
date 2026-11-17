import { AppError, type ReadingControlsSnapshot } from "@read-aware/core";
import { causalActor, copyEventCause, stampEventCause, type DomainActor } from "../../../platform/domain-actor";
import { PendingIntentSlot } from "../../../platform/pending-intent";

type RenderState = { visible: boolean; revision: number; origin: DomainActor };

/** Requested state drives React; only a committed render acknowledges a command. */
export class ReadingControlsController {
  private rendered: ReadingControlsSnapshot = stampEventCause({ visible: false });
  private desired: RenderState = { visible: false, revision: 0, origin: causalActor("system") };
  private readonly pending: PendingIntentSlot<RenderState, ReadingControlsSnapshot>;
  private readonly renderListeners = new Set<() => void>();
  private readonly observers = new Set<(origin?: DomainActor) => void>();

  constructor(
    private readonly report: (error: unknown) => void,
    deadlineMs = 10_000,
  ) {
    this.pending = new PendingIntentSlot({
      deadlineMs,
      timeout: () => new AppError("reader/timeout", "Reader controls did not render"),
      superseded: () => new AppError("reader/superseded", "A newer reader controls intent replaced this command"),
      // The desired visibility returns to what is on screen.
      onExpire: (intent) => this.render(this.rendered.visible, intent.payload.origin),
    });
  }

  getRenderState = (): RenderState => this.desired;
  subscribeRender = (listener: () => void): (() => void) => {
    this.renderListeners.add(listener);
    return () => this.renderListeners.delete(listener);
  };
  snapshot(): ReadingControlsSnapshot {
    return copyEventCause(this.rendered, { ...this.rendered });
  }
  observe(listener: (origin?: DomainActor) => void): () => void {
    this.observers.add(listener);
    return () => this.observers.delete(listener);
  }

  setFromUI = (visible: boolean | ((current: boolean) => boolean), origin: DomainActor = "user"): void => {
    origin = causalActor(origin);
    this.cancel(new AppError("reader/superseded", "A newer reader controls intent replaced this command"));
    this.render(typeof visible === "function" ? visible(this.desired.visible) : visible, origin);
  };

  setVisible(visible: boolean, signal?: AbortSignal, origin: DomainActor = "system"): Promise<ReadingControlsSnapshot> {
    if (typeof visible !== "boolean")
      return Promise.reject(new AppError("reader/invalid-target", "Controls visibility must be boolean"));
    if (signal?.aborted) return Promise.reject(signal.reason);
    origin = causalActor(origin);
    const state = { visible, revision: this.desired.revision + 1, origin };
    const { settled } = this.pending.begin(state, signal);
    this.desired = state;
    this.notify(this.renderListeners);
    return settled;
  }

  acknowledge(state: RenderState): void {
    if (state !== this.desired) return;
    const changed = state.visible !== this.rendered.visible;
    const rendered = stampEventCause({ visible: state.visible }, state.origin);
    this.rendered = rendered;
    const intent = this.pending.current;
    if (intent) this.pending.confirm(intent, this.snapshot());
    if (changed) this.notify(this.observers, state.origin, () => this.rendered === rendered);
  }

  retire(): void {
    this.cancel(new AppError("reader/superseded", "Reader controls session ended"));
    const origin = causalActor("system");
    this.rendered = stampEventCause({ visible: false }, origin);
    this.render(false, origin);
  }

  private cancel(error: unknown): void {
    this.pending.cancel(error);
  }
  private render(visible: boolean, origin: DomainActor): void {
    this.desired = { visible, revision: this.desired.revision + 1, origin };
    this.notify(this.renderListeners);
  }
  private notify(
    listeners: Set<(origin?: DomainActor) => void>,
    origin?: DomainActor,
    current: () => boolean = () => true,
  ): void {
    for (const listener of [...listeners]) {
      if (!current()) break;
      try {
        listener(origin);
      } catch (error) {
        this.report(error);
      }
    }
  }
}
