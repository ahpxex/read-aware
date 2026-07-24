import { invoke } from "@tauri-apps/api/core";
import { isAndroid, isTauri } from "./environment";

/**
 * Custom DOM event dispatched by the Android shell when a captured volume key
 * is pressed. `detail` is the step direction. Keep the name in step with
 * MainActivity.dispatchKeyEvent.
 */
export const VOLUME_STEP_EVENT = "ra-volume-step";

export type VolumeStepDirection = "next" | "prev";

/**
 * Route Android's volume keys to the app (dispatched as VOLUME_STEP_EVENT)
 * instead of the system volume. Enabled only while a text-unit reader mode is
 * on, so the keys keep their normal job otherwise. No-op off Android — iOS
 * offers no public API for capturing the volume buttons.
 */
export function setVolumeKeyCapture(captured: boolean): void {
  if (!isTauri() || !isAndroid()) return;
  void invoke("set_volume_key_capture", { captured }).catch(() => {
    // Older shell builds without the command — stepping stays touch-only.
  });
}
