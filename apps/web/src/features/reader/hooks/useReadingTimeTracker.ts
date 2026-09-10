import { useCallback, useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { readingStatsAtom } from "../../../state/ui";
import { addReadingTime } from "../lib/reading-stats";
import { pausedLongEnough, TICK_MS, tickDelta } from "../lib/reading-session-policy";
import { readingTraces } from "../lib/reading-trace-runtime";

/** Samples activity only. The product session owns writes and final retirement;
 * a React remount transfers the sampler, never guesses whether the book closed. */
export function useReadingTimeTracker(bookId: string | null, active: boolean) {
  const setStats = useSetAtom(readingStatsAtom);
  const activity = useRef<(() => void) | undefined>(undefined);
  const recordActivity = useCallback(() => activity.current?.(), []);
  const trace = bookId ? readingTraces.current(bookId) : undefined;

  useEffect(() => {
    if (!trace || !active) return;
    let lastTickAt = Date.now();
    let lastActivityAt = lastTickAt;
    let pauseClosed = false;
    const commit = () => {
      if (!trace.accepting) return;
      const now = Date.now();
      const delta = tickDelta({ now, lastTickAt, lastActivityAt, active: true,
        foreground: document.visibilityState === "visible" && document.hasFocus() });
      lastTickAt = now;
      if (!pauseClosed && pausedLongEnough(now, lastActivityAt)) {
        pauseClosed = true;
        trace.pause();
      }
      if (delta <= 0) return;
      setStats(previous => addReadingTime(previous, trace.bookId, delta, now));
      trace.accrue(delta, now);
    };
    const onActivity = () => { lastActivityAt = Date.now(); pauseClosed = false; };
    const onResume = () => {
      if (document.visibilityState === "hidden") { commit(); trace.pause(); }
      lastTickAt = Date.now();
      onActivity();
    };
    activity.current = onActivity;
    const unbind = trace.bindSampler(commit);
    const interval = window.setInterval(commit, TICK_MS);
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("pointermove", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("wheel", onActivity, { passive: true });
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      unbind();
      if (activity.current === onActivity) activity.current = undefined;
      window.clearInterval(interval);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("wheel", onActivity);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [trace, active, setStats]);

  return { recordActivity };
}
