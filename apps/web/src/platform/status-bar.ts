import { invoke } from "@tauri-apps/api/core";
import { isAndroid, isTauri } from "./environment";

/**
 * Show/hide the Android system status bar (immersive reading). No-op off
 * Android — macOS has its own traffic-light treatment, and iOS status-bar
 * control isn't wired up yet.
 */
export async function setStatusBarHidden(hidden: boolean): Promise<void> {
  if (!isTauri() || !isAndroid()) return;
  try {
    await invoke("set_status_bar_hidden", { hidden });
  } catch {
    // Older shell builds without the command — reading works fine without
    // the immersive bar, so stay quiet.
  }
}
