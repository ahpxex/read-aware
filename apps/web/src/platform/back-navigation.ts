import { invoke } from "@tauri-apps/api/core";
import { isAndroid, isTauri } from "./environment";

/**
 * Custom DOM event dispatched by the Android shell when the system back
 * button/gesture fires (the shell never finishes the activity itself). It is
 * cancelable: a surface that owns a deeper layer (an open popover, a mode)
 * may consume it with `preventDefault()`; the app-level handler unwinds the
 * main navigation otherwise. Keep the name in step with
 * MainActivity.onCreate's back callback.
 */
export const BACK_REQUEST_EVENT = "ra-back-request";

/**
 * Background the app like Home does — the task leaves the screen but the
 * process (and the loaded book) stays warm for an instant return. Called when
 * back unwinds past the shelf root; letting Android finish() the activity
 * instead would tear down the whole Tauri process and make every return a
 * cold start. No-op off Android.
 */
export function sendAppToBackground(): void {
  if (!isTauri() || !isAndroid()) return;
  void invoke("move_task_to_back").catch(() => {
    // Older shell builds without the command — back simply does nothing at
    // the root, which still beats killing the process.
  });
}
