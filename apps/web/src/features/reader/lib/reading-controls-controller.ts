import { AppError, type ReadingControlsSnapshot } from "@read-aware/core";

type RenderState = { visible: boolean; revision: number };
type Pending = { state: RenderState; resolve(value: ReadingControlsSnapshot): void; reject(error: unknown): void; cleanup(): void };

/** Requested state drives React; only a committed render acknowledges a command. */
export class ReadingControlsController {
  private rendered: ReadingControlsSnapshot = { visible: false };
  private desired: RenderState = { visible: false, revision: 0 };
  private pending: Pending | undefined;
  private readonly renderListeners = new Set<() => void>();
  private readonly observers = new Set<() => void>();

  constructor(private readonly report: (error: unknown) => void, private readonly deadlineMs = 10_000) {}

  getRenderState = (): RenderState => this.desired;
  subscribeRender = (listener: () => void): (() => void) => {
    this.renderListeners.add(listener);
    return () => this.renderListeners.delete(listener);
  };
  snapshot(): ReadingControlsSnapshot { return { ...this.rendered }; }
  observe(listener: () => void): () => void {
    this.observers.add(listener);
    return () => this.observers.delete(listener);
  }

  setFromUI = (visible: boolean | ((current: boolean) => boolean)): void => {
    this.cancel(new AppError("reader/superseded", "A newer reader controls intent replaced this command"));
    this.render(typeof visible === "function" ? visible(this.desired.visible) : visible);
  };

  setVisible(visible: boolean, signal?: AbortSignal): Promise<ReadingControlsSnapshot> {
    if (typeof visible !== "boolean") return Promise.reject(new AppError("reader/invalid-target", "Controls visibility must be boolean"));
    if (signal?.aborted) return Promise.reject(signal.reason);
    this.cancel(new AppError("reader/superseded", "A newer reader controls intent replaced this command"));
    return new Promise((resolve, reject) => {
      const state = { visible, revision: this.desired.revision + 1 };
      const abort = () => {
        if (this.pending?.state !== state) return;
        this.cancel(signal?.reason ?? new AppError("reader/timeout", "Reader controls did not render"));
        this.render(this.rendered.visible);
      };
      const timer = setTimeout(abort, this.deadlineMs);
      this.pending = { state, resolve, reject, cleanup: () => {
        clearTimeout(timer); signal?.removeEventListener("abort", abort);
      } };
      signal?.addEventListener("abort", abort, { once: true });
      this.desired = state;
      this.notify(this.renderListeners);
    });
  }

  acknowledge(state: RenderState): void {
    if (state !== this.desired) return;
    const changed = state.visible !== this.rendered.visible;
    this.rendered = { visible: state.visible };
    const pending = this.pending;
    this.pending = undefined;
    pending?.cleanup();
    const committed = this.snapshot();
    if (changed) this.notify(this.observers);
    pending?.resolve(committed);
  }

  retire(): void {
    this.cancel(new AppError("reader/superseded", "Reader controls session ended"));
    this.rendered = { visible: false };
    this.render(false);
  }

  private cancel(error: unknown): void {
    const pending = this.pending;
    this.pending = undefined;
    pending?.cleanup(); pending?.reject(error);
  }
  private render(visible: boolean): void {
    this.desired = { visible, revision: this.desired.revision + 1 };
    this.notify(this.renderListeners);
  }
  private notify(listeners: Set<() => void>): void {
    for (const listener of [...listeners]) {
      try { listener(); } catch (error) { this.report(error); }
    }
  }
}
