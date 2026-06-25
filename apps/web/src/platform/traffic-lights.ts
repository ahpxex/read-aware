import { invoke } from "@tauri-apps/api/core";
import { isMacOS, isTauri } from "./environment";

/**
 * Show or hide the macOS traffic-light window buttons (desktop shell only).
 *
 * Drives the reader's immersive view: hidden while the overlay header is
 * dismissed, shown when it returns. No-op in a plain browser or off macOS, where
 * there are no native buttons to toggle.
 */
export async function setTrafficLightsVisible(visible: boolean): Promise<void> {
  if (!isTauri() || !isMacOS()) return;
  try {
    await invoke("set_traffic_lights_visible", { visible });
  } catch {
    // Non-fatal: the window controls simply stay in their current state.
  }
}
