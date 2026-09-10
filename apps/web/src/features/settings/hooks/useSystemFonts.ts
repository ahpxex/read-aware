import { useCallback, useEffect, useState } from "react";
import { listSystemFonts } from "../lib/system-fonts";
import { createLogger } from "../../../platform/logger";

const log = createLogger("system-fonts");

/**
 * The installed font families, loaded once for the reader font picker. Empty
 * until enumeration resolves (and stays empty off the desktop shell). Loading
 * and failure are separate so the picker does not pretend a failed scan is empty.
 */
export function useSystemFonts() {
  const [fonts, setFonts] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listSystemFonts().then((list) => {
      if (active) { setFonts(list); setLoading(false); }
    }, error => {
      log.warn("System font enumeration failed", error);
      if (active) { setError(error); setLoading(false); }
    });
    return () => {
      active = false;
    };
  }, [attempt]);

  return { fonts, error, loading, retry };
}
