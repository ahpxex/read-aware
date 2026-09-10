import { useCallback, useRef, useState } from "react";
import type { PluginAction } from "../lib/plugin-types";
import type { PluginResultRunner } from "../components/plugin-view-types";

/** Cancellation is another owned action, not proof that background work stopped. */
export function usePluginProgressCancel(action: Pick<PluginAction, "run">, onResult: PluginResultRunner) {
  const flight = useRef(false);
  const [pending, setPending] = useState(false);
  const cancel = useCallback(async () => {
    if (flight.current) return;
    flight.current = true; setPending(true);
    try { await onResult(action.run, { background: true }); }
    finally { flight.current = false; setPending(false); }
  }, [action.run, onResult]);
  return { pending, cancel };
}
