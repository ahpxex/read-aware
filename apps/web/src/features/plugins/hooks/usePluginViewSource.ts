import { useCallback, useEffect, useRef, useState } from "react";
import type { PluginView } from "../lib/plugin-types";
import { observePluginCallbackOwners, releasePluginCallbacks } from "../runtime/plugin-callback-wire";
import { createLogger } from "../../../platform/logger";

const log = createLogger("plugin-views");
const discard = (view: PluginView | null, transferred?: PluginView) => {
  try { releasePluginCallbacks(view, transferred); } catch (error) { log.warn("Unconsumed view cleanup failed", error); }
};

/** Latest-source wins, including replacement registrations with the same key. */
export function usePluginViewSource(
  source: unknown,
  enabled: boolean,
  load: () => PluginView | Promise<PluginView>,
  onFailure: () => void,
  contextKey?: string,
) {
  const [view, setView] = useState<PluginView | null>(null);
  const current = useRef<PluginView | null>(null);
  const revision = useRef(0);
  const live = useRef(false);
  const latest = useRef({ load, onFailure });
  latest.current = { load, onFailure };
  const refresh = useCallback(() => {
    if (!live.current) return;
    const request = ++revision.current;
    const loadView = latest.current.load;
    void Promise.resolve().then(async () => {
      if (!live.current || request !== revision.current) return;
      const next = await loadView();
      if (!live.current || request !== revision.current) { discard(next); return; }
      const previous = current.current;
      current.current = next;
      setView(next);
      if (previous !== next) discard(previous, next);
    }).catch(error => {
      log.error("Plugin root view loading failed", error);
      if (live.current && request === revision.current) latest.current.onFailure();
    });
  }, []);
  useEffect(() => {
    live.current = enabled;
    setView(null);
    let unwatch = () => {};
    try {
      unwatch = observePluginCallbackOwners(source, () => {
        live.current = false;
        revision.current++;
        discard(current.current);
        current.current = null;
        setView(null);
      });
    } catch (error) {
      live.current = false;
      log.warn("Plugin view source is unavailable", error);
    }
    if (enabled) refresh();
    return () => {
      unwatch();
      live.current = false;
      revision.current++;
      discard(current.current);
      current.current = null;
    };
  }, [source, enabled, contextKey, refresh]);
  return { view, refresh };
}
