import { useCallback, useEffect, useRef, useState } from "react";
import { useSetAtom } from "jotai";
import { readingStatsAtom } from "../../../state/ui";
import { addReadingTime } from "../lib/reading-stats";
import { ActiveReadingClock, bankableMs, MIN_BANK_MS, pausedLongEnough, TICK_MS } from "../lib/reading-session-policy";
import { readingTraces } from "../lib/reading-trace-runtime";

function inForeground(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

/** Samples activity only. The product session owns writes and final retirement;
 * a React remount transfers the sampler, never guesses whether the book closed.
 * The returned clock is the one every reading-time display reads from. */
export function useReadingTimeTracker(bookId: string | null, active: boolean) {
  const setStats = useSetAtom(readingStatsAtom);
  const activity = useRef<(() => void) | undefined>(undefined);
  const recordActivity = useCallback(() => activity.current?.(), []);
  const [clock, setClock] = useState<ActiveReadingClock | null>(null);
  const trace = bookId ? readingTraces.current(bookId) : undefined;

  useEffect(() => {
    if (!trace || !active) return;
    const readingClock = new ActiveReadingClock(performance.now(), inForeground());
    setClock(readingClock);
    let bankedMs = 0;
    let pauseClosed = false;
    const commit = () => {
      if (!trace.accepting) return;
      const at = performance.now();
      readingClock.setForeground(at, inForeground());
      // Close the open session once per pause; acting again reopens it.
      const paused = pausedLongEnough(readingClock.idleMs(at));
      if (paused && !pauseClosed) trace.pause();
      pauseClosed = paused;
      const delta = bankableMs(readingClock.totalMs, bankedMs);
      if (delta < MIN_BANK_MS) return;
      bankedMs += delta;
      const now = Date.now();
      setStats((previous) => addReadingTime(previous, trace.bookId, delta, now));
      trace.accrue(delta, now);
    };
    const onActivity = () => {
      readingClock.activity(performance.now(), inForeground());
    };
    const onForegroundChange = () => {
      if (document.visibilityState === "hidden") {
        commit();
        trace.pause();
        return;
      }
      readingClock.setForeground(performance.now(), inForeground());
    };
    activity.current = onActivity;
    const unbind = trace.bindSampler(commit);
    const interval = window.setInterval(commit, TICK_MS);
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("pointermove", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("wheel", onActivity, { passive: true });
    window.addEventListener("focus", onForegroundChange);
    window.addEventListener("blur", onForegroundChange);
    document.addEventListener("visibilitychange", onForegroundChange);
    return () => {
      unbind();
      if (activity.current === onActivity) activity.current = undefined;
      setClock((current) => (current === readingClock ? null : current));
      window.clearInterval(interval);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("wheel", onActivity);
      window.removeEventListener("focus", onForegroundChange);
      window.removeEventListener("blur", onForegroundChange);
      document.removeEventListener("visibilitychange", onForegroundChange);
    };
  }, [trace, active, setStats]);

  return { recordActivity, readingClock: clock };
}
