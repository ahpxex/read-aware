import { useEffect } from "react";
import { setTrafficLightsVisible } from "../../../platform/traffic-lights";

/**
 * Sync the macOS traffic lights with the reader's overlay header: the native
 * buttons show only while `visible` is true (header up) and hide during
 * immersive reading. The reader always restores them on unmount so the rest of
 * the app keeps its window controls.
 *
 * Restoration lives in its own mount-scoped effect rather than the sync effect's
 * cleanup, so toggling `visible` does not flash the buttons on/off.
 */
export function useImmersiveWindowControls(visible: boolean): void {
  useEffect(() => {
    void setTrafficLightsVisible(visible);
  }, [visible]);

  useEffect(() => {
    return () => {
      void setTrafficLightsVisible(true);
    };
  }, []);
}
