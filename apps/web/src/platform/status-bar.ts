import { invoke } from "@tauri-apps/api/core";
import { isMobileOS, isTauri } from "./environment";

/**
 * Show/hide the mobile system status bar (immersive reading). Android goes
 * through MainActivity, iOS through an ObjC bridge on the root view
 * controller; desktop is a no-op — macOS has its own traffic-light treatment.
 */
export async function setStatusBarHidden(hidden: boolean): Promise<void> {
  if (!isTauri() || !isMobileOS()) return;
  try {
    await invoke("set_status_bar_hidden", { hidden });
  } catch {
    // Older shell builds without the command — reading works fine without
    // the immersive bar, so stay quiet.
  }
}
