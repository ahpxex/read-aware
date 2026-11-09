import { useEffect, useState } from "react";
import { readingRuntime } from "../../../domain/reading-runtime";
import { canStepReadingHistory } from "../lib/reading-history";

/** Whether the open book's jump history can go back / forward, live. */
export function useReadingHistory(active = true): { ready: boolean; canGoBack: boolean; canGoForward: boolean } {
  const [session, setSession] = useState(() => readingRuntime.snapshot());
  useEffect(() => {
    if (!active) return;
    setSession(readingRuntime.snapshot());
    return readingRuntime.observe(setSession);
  }, [active]);
  return {
    ready: session.status === "ready",
    canGoBack: canStepReadingHistory(session, "back"),
    canGoForward: canStepReadingHistory(session, "forward"),
  };
}
