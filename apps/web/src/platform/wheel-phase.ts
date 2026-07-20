import { listen } from "@tauri-apps/api/event";
import { isTauri } from "./environment";

/**
 * Ground-truth trackpad gesture phases from the desktop shell.
 *
 * DOM wheel events never say whether fingers are on the pad, so a swipe's
 * momentum tail is indistinguishable from a new swipe by deltas alone. On
 * macOS the shell watches every scroll-wheel NSEvent (see
 * `install_scroll_phase_monitor` in the Tauri crate) and emits just the
 * transitions:
 *
 * - `"touch"`    — fingers landed on the pad (also cancels any momentum)
 * - `"momentum"` — fingers lifted and the momentum tail began
 * - `"end"`      — the momentum tail finished (or was cancelled)
 *
 * Other platforms emit nothing — subscribers simply never hear an edge and
 * keep their heuristic behavior. Keep the event name in step with the shell.
 */
export const WHEEL_PHASE_EVENT = "ra-wheel-phase";

export type WheelPhaseEdge = "touch" | "momentum" | "end";

/**
 * Subscribe to the shell's wheel phase edges. Returns the unsubscribe
 * function; a no-op outside the Tauri shell.
 */
export function subscribeWheelPhaseEdges(
  onEdge: (edge: WheelPhaseEdge) => void,
): () => void {
  if (!isTauri()) return () => {};
  let disposed = false;
  let unlisten: (() => void) | null = null;
  void listen<string>(WHEEL_PHASE_EVENT, ({ payload }) => {
    if (payload === "touch" || payload === "momentum" || payload === "end") {
      onEdge(payload);
    }
  }).then((stop) => {
    // Registration is async — the subscriber may already be gone.
    if (disposed) stop();
    else unlisten = stop;
  });
  return () => {
    disposed = true;
    unlisten?.();
    unlisten = null;
  };
}
