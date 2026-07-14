import { invoke } from "@tauri-apps/api/core";
import { isAndroid, isTauri } from "./environment";

/**
 * Custom DOM event dispatched by the Android shell when the system back
 * button/gesture fires (the shell never finishes the activity itself). It is
 * cancelable: a surface that owns a deeper layer (an open sheet, a mode)
 * consumes it by registering a `registerBackInterceptor` callback; the
 * app-level handler unwinds the main navigation otherwise. Keep the name in
 * step with MainActivity.onCreate's back callback.
 */
export const BACK_REQUEST_EVENT = "ra-back-request";

/**
 * Claim handler for one back request. Return `true` to consume it (after
 * closing whatever layer the caller owns); `false` lets it fall through.
 */
export type BackRequestInterceptor = () => boolean;

const backInterceptors: BackRequestInterceptor[] = [];

/**
 * Give a deeper UI layer first claim on the Android back gesture. Interceptors
 * are consulted newest-first, so the most recently opened layer unwinds first.
 * Returns the unregister function.
 */
export function registerBackInterceptor(
  interceptor: BackRequestInterceptor,
): () => void {
  backInterceptors.push(interceptor);
  return () => {
    const index = backInterceptors.indexOf(interceptor);
    if (index !== -1) backInterceptors.splice(index, 1);
  };
}

// The shell dispatches the event AT `window`, where capture/bubble makes no
// difference — only registration order decides who runs first. Surfaces mount
// lazily, so a component-registered listener cannot reliably beat the
// app-level unwinding listener (added in App's effects); a listener attached
// at module evaluation always does, because App imports this module before it
// renders. Hence: register once here, never from a component.
if (typeof window !== "undefined") {
  window.addEventListener(BACK_REQUEST_EVENT, (event) => {
    if (event.defaultPrevented) return;
    for (let i = backInterceptors.length - 1; i >= 0; i -= 1) {
      if (backInterceptors[i]()) {
        event.preventDefault();
        return;
      }
    }
  });
}

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
