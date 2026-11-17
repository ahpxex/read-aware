import { useCallback, useEffect, useState } from "react";
import type { ActiveReadingClock } from "../lib/reading-session-policy";

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Active reading time since the timer appeared (mode re-entry starts over).
 * It reads the same clock as the reading statistics, so the floating timer
 * and the stats count the same seconds; it never keeps a rule of its own. */
export function useSessionTimer(enabled: boolean, clock: ActiveReadingClock | null) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [showClock, setShowClock] = useState(false);
  const toggleClock = useCallback(() => {
    setNow(new Date());
    setShowClock((value) => !value);
  }, []);

  useEffect(() => {
    setElapsedSeconds(0);
    setShowClock(false);
    if (!enabled || !clock) return;
    clock.sample(performance.now());
    const startMs = clock.totalMs;
    const refresh = () => {
      clock.sample(performance.now());
      setElapsedSeconds(Math.floor((clock.totalMs - startMs) / 1000));
      setNow(new Date());
    };
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [enabled, clock]);

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  const elapsed = hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
  return { elapsed: enabled && clock ? elapsed : null, now, showClock, toggleClock };
}
