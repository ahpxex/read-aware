import { useCallback } from "react";
import type { HostMaintenanceSurface } from "@read-aware/core";
import { hostMaintenance } from "../../../services/maintenance";

/** Callback-ref cleanup retires the exact mounted control, including StrictMode remounts. */
export function useMaintenanceSurface(surface: HostMaintenanceSurface) {
  return useCallback((element: HTMLButtonElement | null) => {
    if (!element) return;
    return hostMaintenance.bindSurface(surface, () => {
      element.scrollIntoView({ block: "center" });
      element.focus({ preventScroll: true });
    });
  }, [surface]);
}
