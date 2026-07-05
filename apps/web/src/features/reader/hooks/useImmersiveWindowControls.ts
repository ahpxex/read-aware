import { useEffect } from "react";
import { setStatusBarHidden } from "../../../platform/status-bar";
import { setTrafficLightsVisible } from "../../../platform/traffic-lights";

/**
 * Sync the platform's window chrome with the reader's overlay header: while
 * `visible` is false (immersive reading) the macOS traffic lights and the
 * Android status bar hide; both return with the header and are always
 * restored on unmount so the rest of the app keeps its chrome.
 *
 * Restoration lives in its own mount-scoped effect rather than the sync effect's
 * cleanup, so toggling `visible` does not flash the chrome on/off.
 */
export function useImmersiveWindowControls(visible: boolean): void {
  useEffect(() => {
    void setTrafficLightsVisible(visible);
    void setStatusBarHidden(!visible);
  }, [visible]);

  useEffect(() => {
    return () => {
      void setTrafficLightsVisible(true);
      void setStatusBarHidden(false);
    };
  }, []);
}
