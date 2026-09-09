import { isTauri } from "./environment";
import { createLogger } from "./logger";

const log = createLogger("wheel-phase");

/**
 * Ground-truth trackpad gesture phases from the desktop shell.
 *
 * DOM wheel events never say whether fingers are on the pad, so a swipe's
 * momentum tail is indistinguishable from a new swipe by deltas alone. On
 * macOS the shell watches every scroll-wheel NSEvent (see
 * `wheel_phase::install` in the Tauri crate) and dispatches just the
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
 * The shell dispatches into the current main document. Registration and
 * removal are synchronous DOM operations, not an async native subscription
 * whose registration may outlive the reader that requested it.
 */
export function subscribeWheelPhaseEdges(
  onEdge: (edge: WheelPhaseEdge) => void,
): () => void {
  if (!isTauri()) return () => {};
  const target = window;
  const handler = (event: Event) => {
    const edge: unknown = (event as CustomEvent<unknown>).detail;
    if (edge !== "touch" && edge !== "momentum" && edge !== "end") return;
    try { Promise.resolve(onEdge(edge)).catch(error => log.warn("Wheel phase consumer failed", error)); }
    catch (error) { log.warn("Wheel phase consumer failed", error); }
  };
  target.addEventListener(WHEEL_PHASE_EVENT, handler);
  return () => {
    target.removeEventListener(WHEEL_PHASE_EVENT, handler);
  };
}
