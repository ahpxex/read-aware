import type { PluginContext, PluginDisposable, PluginView } from "@read-aware/plugin-types";
import { failureCode } from "./operations";

export function liveView<T>(ctx: PluginContext, signal: AbortSignal, initial: T,
  observe: (handler: (value: T) => void) => PluginDisposable, render: (value: T) => PluginView): PluginView {
  return { ...render(initial), live: { subscribe(channel) {
    signal.throwIfAborted();
    let active = true, revision = 0;
    const subscription = observe(value => {
      if (!active || signal.aborted) return;
      void ctx.services.ui.publishView(channel, { revision: ++revision, view: render(value) }).catch(async error => {
        try { await ctx.services.logging.write({ level: "warn", event: "maintenance-view-publish-failed", errorCode: failureCode(error) }); }
        catch { /* A retired host can reject logging; reopening performs a fresh query. */ }
      });
    });
    const dispose = () => {
      if (!active) return;
      active = false;
      signal.removeEventListener("abort", dispose);
      subscription.dispose();
    };
    signal.addEventListener("abort", dispose, { once: true });
    if (signal.aborted) dispose();
    return { dispose };
  } } };
}
