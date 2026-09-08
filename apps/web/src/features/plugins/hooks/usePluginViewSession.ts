import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import type { PluginView } from "../lib/plugin-types";
import { PluginViewSession } from "../lib/plugin-view-session";

export function usePluginViewSession(
  view: PluginView | null,
  provided: PluginViewSession | undefined,
  onClose?: () => void,
  onRefresh?: () => void,
) {
  const [owned] = useState(() => new PluginViewSession());
  const session = provided ?? owned;
  useLayoutEffect(() => { session.configure({ close: onClose, refresh: onRefresh }); }, [session, onClose, onRefresh]);
  useLayoutEffect(() => {
    if (provided) return;
    session.resume();
    session.setRoot(view);
    return () => {
      const epoch = session.suspend();
      // StrictMode's cleanup/setup pair may reuse this owner synchronously.
      // Real unmount invalidates operations immediately and releases next microtask.
      queueMicrotask(() => session.disposeIfSuspended(epoch));
    };
  }, [session, provided, view]);
  return { session, ...useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot) };
}
