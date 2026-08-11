import { useEffect, useState } from "react";

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Elapsed time since `running` last became true, formatted `m:ss` (or
 * `h:mm:ss` past the hour). Deliberately session-only: the clock restarts on
 * every rising edge and nothing is ever persisted — leaving and re-entering
 * the mode starts from zero.
 */
export function useSessionTimer(running: boolean): string | null {
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!running) {
      setElapsedSeconds(null);
      return;
    }
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timer = setInterval(
      () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [running]);

  if (elapsedSeconds === null) return null;
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}
