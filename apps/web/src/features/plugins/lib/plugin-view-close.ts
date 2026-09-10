import type { PluginView, PluginViewCloseReason } from "./plugin-types";
import { pluginCallbackOwner, releasePluginCallbacks, retainPluginCallbacks } from "../runtime/plugin-callback-wire";
import { createLogger } from "../../../platform/logger";

const log = createLogger("plugin-view-close");

/** A frame's original notification survives content refreshes, but never owns navigation. */
export function ownPluginViewClose(callback: PluginView["onClose"], deadlineMs = 10_000) {
  const release = retainPluginCallbacks(callback);
  let notified = false, disposed = false;
  return {
    notify(reason: PluginViewCloseReason): void {
      if (disposed || notified || !callback) return;
      notified = true;
      const owner = pluginCallbackOwner(callback);
      if (owner?.aborted) return; // A retired Worker cannot receive view notifications.
      const releaseCall = retainPluginCallbacks(callback);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true; clearTimeout(timer); owner?.removeEventListener("abort", finish);
        try { releaseCall(); } catch (error) { log.warn("View close callback lease cleanup failed", error); }
      };
      const timer = setTimeout(() => {
        log.warn("View close callback exceeded its retention deadline"); finish();
      }, deadlineMs);
      owner?.addEventListener("abort", finish, { once: true });
      // Notify after the synchronous navigation mutation; local callbacks cannot
      // re-enter a half-updated stack. A result is discarded, not an action result.
      void Promise.resolve().then(() => {
        if (!finished && !owner?.aborted) return callback({ reason });
      }).then(result => releasePluginCallbacks(result)).catch(error => {
        if (!owner?.aborted) log.warn("View close callback failed", error);
      }).finally(finish);
    },
    dispose(): void { if (!disposed) { disposed = true; release(); } },
  };
}
