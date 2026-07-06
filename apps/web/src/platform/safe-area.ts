import { invoke } from "@tauri-apps/api/core";
import { isAndroid, isTauri } from "./environment";

/**
 * Ask the Android shell to push the real system-bar/cutout insets into the
 * `--ra-safe-*` CSS variables. Android's WebView never surfaces those insets
 * through `env(safe-area-inset-*)` (unlike iOS), so in the edge-to-edge app
 * window the variables would resolve to 0 and fixed chrome would lay out
 * under the status bar. The native side keeps them updated on every insets
 * change (rotation, status-bar show/hide); this one boot-time call covers the
 * freshly loaded document, which starts back at the CSS defaults.
 */
export function syncAndroidSafeArea(): void {
  if (!isTauri() || !isAndroid()) return;
  void invoke("sync_safe_area").catch(() => {
    // Older shell builds without the command — chrome stays under the bar.
  });
}
