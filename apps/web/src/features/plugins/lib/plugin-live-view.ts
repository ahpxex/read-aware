import { AppError } from "@read-aware/core";
import type { PluginDisposable, PluginView, PluginViewContent } from "./plugin-types";
import { openPluginViewChannel } from "./plugin-view-channels";
import { PluginViewError } from "./plugin-view";
import { pluginCallbackOwner, releasePluginCallbacks, retainPluginCallbacks } from "../runtime/plugin-callback-wire";
import { createLogger } from "../../../platform/logger";

const log = createLogger("plugin-live-view");
type Live = NonNullable<PluginView["live"]>;
type Run = { stop: () => void; closed: boolean; resource?: PluginDisposable; release?: () => void };

/** Visible-frame subscription lifecycle, independent of React and domain-specific data. */
export class PluginLiveView {
  private run?: Run;
  private disposed = false;
  private failed = false;
  private readonly releaseLive: () => void;
  constructor(private readonly live: Live, private readonly apply: (view: PluginViewContent) => void,
    private readonly failure: (error: unknown) => void) {
    this.releaseLive = retainPluginCallbacks(live);
  }

  setVisible(visible: boolean): void {
    if (!visible || this.disposed) { this.stop(); return; }
    if (this.run || this.failed) return;
    const run: Run = { stop: () => {}, closed: false };
    this.run = run;
    const fail = (error: unknown) => {
      if (this.run !== run || run.closed) return;
      this.failed = true; this.stop();
      log.warn("Live view subscription failed", error); this.failure(error);
    };
    try {
      const owner = pluginCallbackOwner(this.live.subscribe);
      if (!owner) throw new AppError("plugin/invalid-input", "Live views must belong to a hosted plugin activation");
      const channel = openPluginViewChannel(owner, update => {
        try {
          if (!update.view || typeof update.view !== "object" || "live" in update.view || "onClose" in update.view) {
            throw new AppError("plugin/invalid-input", "Live updates must contain only view content");
          }
          this.apply(update.view);
        } catch (error) {
          const failure = error instanceof PluginViewError
            ? new AppError("plugin/invalid-input", error.message, { cause: error }) : error;
          fail(failure); throw failure;
        }
      });
      run.stop = channel.dispose;
      void Promise.resolve().then(() => {
        if (run.closed) return null;
        return this.live.subscribe(channel.channel);
      }).then(resource => {
        if (resource === null && run.closed) return;
        const release = retainPluginCallbacks(resource);
        if (!resource || typeof resource.dispose !== "function") {
          release(); throw new AppError("plugin/invalid-input", "A live subscription must return a disposer");
        }
        run.resource = resource; run.release = release;
        if (run.closed) this.cleanup(run);
      }).catch(fail);
    } catch (error) { fail(error); }
  }

  private cleanup(run: Run): void {
    const resource = run.resource, release = run.release;
    run.resource = undefined; run.release = undefined;
    if (!resource) return;
    void Promise.resolve().then(() => resource.dispose()).catch(error => {
      log.warn("Live view subscription cleanup failed", error);
    }).finally(() => {
      try { release?.(); releasePluginCallbacks(resource); }
      catch (error) { log.warn("Live view disposer callback cleanup failed", error); }
    });
  }

  private stop(): void {
    const run = this.run; this.run = undefined;
    if (!run) return;
    run.closed = true; run.stop(); this.cleanup(run);
  }
  retry(): void { this.failed = false; this.stop(); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.stop(); this.releaseLive();
  }
}
