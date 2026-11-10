import { useEffect, useState } from "react";

/**
 * How long opening a book may take before the reader says it is working on
 * it. An ordinary open is well inside this on every device, so it never
 * flashes a spinner between the shelf and the page.
 */
export const SLOW_OPEN_MS = 800;

/**
 * Returns `true` only once `active` has stayed `true` continuously for
 * `delayMs`, and resets immediately when `active` goes back to `false`.
 *
 * Use it to avoid flashing a loading indicator for operations that usually
 * finish faster than `delayMs` — the indicator only appears when something is
 * genuinely slow.
 */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return;
    }
    const timer = window.setTimeout(() => setElapsed(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);

  return active && elapsed;
}
