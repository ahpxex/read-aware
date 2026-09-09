import type { PluginView, PluginViewResult } from "./plugin-types";
import type { PluginResultOptions } from "../components/plugin-view-types";
import { navigatePluginViewStack, normalizePluginView, PluginViewError } from "./plugin-view";
import { observePluginCallbackOwners, releasePluginCallbacks, retainPluginCallbacks } from "../runtime/plugin-callback-wire";
import { createLogger } from "../../../platform/logger";
import { showPluginFailureToast, showPluginToast } from "./plugin-toast";
import { PluginLiveView } from "./plugin-live-view";

const log = createLogger("plugin-views");
type Frame = { view: PluginView; renderKey: number; dispose: () => void; rendered?: () => void; live?: PluginLiveView; liveError?: unknown };
type Effects = { close?: () => void; refresh?: () => void; toast?: (text: string) => void; failure?: (error: unknown) => void };
export type PluginViewSnapshot = {
  stack: readonly PluginView[];
  /** Explicit navigation replaces UI state, unlike a refresh of root data. */
  renderKey: number | null;
  busy: boolean;
  error: boolean;
  liveError: unknown;
  dialog: { requestId: number; title: string; session: PluginViewSession } | null;
};

/** Own the normalized callbacks, not discarded fields from a raw declaration. */
function ownView(raw: PluginView, onRetired: () => void, renderKey: number): Frame {
  const releaseRaw = retainPluginCallbacks(raw);
  try {
    const view = normalizePluginView(raw);
    const unwatch = observePluginCallbackOwners(raw, onRetired);
    let releaseView: () => void;
    try { releaseView = retainPluginCallbacks(view); }
    catch (error) { unwatch(); throw error; }
    return { view, renderKey, dispose: () => { unwatch(); releaseView(); } };
  } finally { releaseRaw(); }
}

/** Resource ownership and async navigation are independent of React rendering. */
export class PluginViewSession {
  private frames: Frame[] = [];
  private root: PluginView | null | undefined;
  private epoch = 0;
  private active = true;
  private nextRequest = 0;
  private nextFrameKey = 0;
  private inlineRequest = 0;
  private readonly foreground = new Set<number>();
  private readonly listeners = new Set<() => void>();
  private snapshot: PluginViewSnapshot = { stack: [], renderKey: null, busy: false, error: false, liveError: null, dialog: null };

  constructor(private effects: Effects = {}) {}
  configure(effects: Effects): void { this.effects = effects; }
  getSnapshot = (): PluginViewSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };

  private publish(patch: Partial<PluginViewSnapshot> = {}): void {
    const dialog = patch.dialog === undefined ? this.snapshot.dialog : patch.dialog;
    for (const frame of this.frames) frame.live?.setVisible(this.active && frame === this.frames.at(-1) && !dialog);
    this.snapshot = { ...this.snapshot, stack: this.frames.map(frame => frame.view), renderKey: this.frames.at(-1)?.renderKey ?? null,
      busy: this.foreground.size > 0, liveError: this.frames.at(-1)?.liveError ?? null, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  private release(dispose: () => void): void {
    try { dispose(); } catch (error) { log.warn("View callback cleanup failed", error); }
  }

  private replaceFrames(next: Frame[]): void {
    const previous = this.frames;
    this.frames = next;
    for (const frame of previous) if (!next.includes(frame)) this.release(frame.dispose);
  }

  private ownFrame(raw: PluginView, renderKey: number): Frame {
    let current = ownView(raw, this.close, renderKey);
    let painted: Frame | undefined;
    const frame: Frame = { ...current,
      rendered: () => {
        const prior = painted; painted = current;
        if (prior && prior !== current) this.release(prior.dispose);
      },
      dispose: () => {
        frame.live?.dispose(); current.dispose();
        if (painted && painted !== current) painted.dispose();
      },
    };
    try {
      if (current.view.live) frame.live = new PluginLiveView(current.view.live, next => {
        const replacement = ownView(next, this.close, renderKey);
        const previous = current; current = replacement; frame.view = replacement.view;
        // Keep only the visible callbacks plus the latest unpainted snapshot.
        // A button in the old React commit must not lose its handle mid-click.
        if (previous !== painted) this.release(previous.dispose);
        this.publish();
      }, error => { frame.liveError = error; this.publish(); });
      return frame;
    } catch (error) { current.dispose(); throw error; }
  }

  acknowledgeRender = (view: PluginView | null): void => {
    const frame = this.frames.at(-1);
    if (frame?.view === view) frame.rendered?.();
  };

  retryLive = (): void => {
    const frame = this.frames.at(-1);
    if (!this.active || !frame?.live) return;
    frame.liveError = null; frame.live.retry(); this.publish();
  };

  setRoot(view: PluginView | null): void {
    if (this.root === view) return;
    this.root = view;
    this.epoch++;
    this.foreground.clear();
    this.closeDialog();
    let frame: Frame | undefined;
    let error = false;
    try {
      // Live root-data refreshes retain drafts. An explicit action returning a
      // view below always receives a new key, even at the same stack depth.
      if (view) frame = this.ownFrame(view, this.frames.length === 1 ? this.frames[0].renderKey : ++this.nextFrameKey);
    }
    catch (failure) {
      error = true;
      log.error("Plugin root view failed validation", failure);
      this.release(() => releasePluginCallbacks(view));
    }
    this.replaceFrames(frame ? [frame] : []);
    this.publish({ error });
  }

  resume(): void { this.active = true; this.publish(); }
  suspend(): number {
    this.active = false;
    for (const frame of this.frames) frame.live?.setVisible(false);
    this.foreground.clear();
    return ++this.epoch;
  }
  disposeIfSuspended(epoch: number): void {
    if (!this.active && this.epoch === epoch) this.dispose();
  }
  dispose(): void {
    this.suspend();
    this.root = undefined;
    this.closeDialog();
    this.replaceFrames([]);
    this.publish();
  }
  close = (): void => { this.dispose(); this.effects.close?.(); };
  back = (): void => {
    if (!this.active || this.frames.length < 2) return;
    this.epoch++;
    this.foreground.clear();
    this.closeDialog();
    this.replaceFrames(this.frames.slice(0, -1));
    this.publish();
  };
  closeDialog = (refresh = false): void => {
    const previous = this.snapshot.dialog;
    if (!previous) return;
    this.snapshot = { ...this.snapshot, dialog: null };
    previous.session.dispose();
    this.publish();
    if (refresh) this.effects.refresh?.();
  };

  run = async (run: () => PluginViewResult | Promise<PluginViewResult>, options?: PluginResultOptions): Promise<PluginViewResult> => {
    if (!this.active || !this.frames.length) return null;
    const source = this.frames.at(-1);
    const epoch = this.epoch;
    const request = ++this.nextRequest;
    const dialog = options?.presentation === "dialog";
    if (dialog) {
      this.closeDialog();
      this.publish({ dialog: { requestId: request, title: options?.dialogTitle ?? "", session: new PluginViewSession() } });
    } else {
      this.inlineRequest = request;
      if (!options?.background) this.foreground.add(request);
      this.publish();
    }
    const current = () => this.active && epoch === this.epoch && source === this.frames.at(-1)
      && (dialog ? this.snapshot.dialog?.requestId === request : this.inlineRequest === request);
    let releaseResult = () => {};
    try {
      const result = await run();
      releaseResult = retainPluginCallbacks(result);
      if (!current()) return null;
      if (result == null) { if (dialog) this.closeDialog(); return result; }
      if (typeof result !== "object" || Array.isArray(result)) throw new PluginViewError("Plugin action result must be an object");
      if (result.fieldErrors) {
        if (dialog) throw new PluginViewError("Dialog item cannot return form field errors");
      } else if (result.view) {
        if (dialog) this.snapshot.dialog!.session.setRoot(result.view);
        else {
          const frame = this.ownFrame(result.view, ++this.nextFrameKey);
          try {
            const next = navigatePluginViewStack(this.frames.map(item => item.view), frame.view, result.navigation);
            const existing = new Map(this.frames.map(item => [item.view, item]));
            this.replaceFrames(next.map(view => view === frame.view ? frame : existing.get(view)!));
          } catch (error) { this.release(frame.dispose); throw error; }
          this.closeDialog();
          this.publish();
        }
      } else if (result.navigation) throw new PluginViewError("Plugin navigation requires a view");
      else if (result.close) { if (dialog) this.closeDialog(true); else this.close(); }
      else if (dialog) this.closeDialog();
      if (result.toast) (this.effects.toast ?? showPluginToast)(String(result.toast));
      return result;
    } catch (error) {
      log.error("Plugin view action failed", error);
      if (current()) {
        if (dialog) this.closeDialog();
        if (this.effects.failure) this.effects.failure(error);
        else showPluginFailureToast(undefined, error);
      }
      return null;
    } finally {
      this.release(releaseResult);
      this.foreground.delete(request);
      if (this.active) this.publish();
    }
  };
}
