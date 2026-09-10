import { useEffect, useState } from "react";
import { hostWindow } from "../../../services/window";

/** Caption controls consume the same OS state as plugins and the Agent. */
export function useWindowMaximized(enabled = true): boolean {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    return hostWindow.observe(value => {
      if (value.status === "ready") setMaximized(value.snapshot.supported && value.snapshot.maximized);
      // Observation failures are logged by the service; preserve the last icon.
    });
  }, [enabled]);
  return maximized;
}
