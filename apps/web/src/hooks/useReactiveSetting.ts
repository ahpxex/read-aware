import { useCallback, useEffect, useRef } from "react";

const DEFAULT_SAVE_DELAY_MS = 300;

type ReactiveSettingOptions<T> = {
  value: T;
  revision: number;
  persist: (value: T) => void;
  enabled?: boolean;
  delayMs?: number;
};

/**
 * Debounced write-through for editable settings with text input. Discrete
 * controls can use the same path, while blur, page-hide, and unmount flush the
 * latest valid value so the UI never needs an explicit Save action.
 *
 * `revision` must only advance for user edits. This keeps mounting a settings
 * surface from manufacturing a stored configuration out of its defaults.
 */
export function useReactiveSetting<T>({
  value,
  revision,
  persist,
  enabled = true,
  delayMs = DEFAULT_SAVE_DELAY_MS,
}: ReactiveSettingOptions<T>): {
  flush: () => void;
  discardPending: () => void;
} {
  const latestValueRef = useRef(value);
  const latestRevisionRef = useRef(revision);
  const persistRef = useRef(persist);
  const enabledRef = useRef(enabled);
  const persistedRevisionRef = useRef(revision);
  const timerRef = useRef<number | null>(null);

  latestValueRef.current = value;
  latestRevisionRef.current = revision;
  persistRef.current = persist;
  enabledRef.current = enabled;

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const flush = useCallback(() => {
    clearTimer();
    if (
      !enabledRef.current ||
      latestRevisionRef.current <= persistedRevisionRef.current
    ) {
      return;
    }
    persistRef.current(latestValueRef.current);
    persistedRevisionRef.current = latestRevisionRef.current;
  }, [clearTimer]);

  const discardPending = useCallback(() => {
    clearTimer();
    persistedRevisionRef.current = latestRevisionRef.current;
  }, [clearTimer]);

  useEffect(() => {
    clearTimer();
    if (!enabled || revision <= persistedRevisionRef.current) return;
    timerRef.current = window.setTimeout(flush, delayMs);
    return clearTimer;
  }, [clearTimer, delayMs, enabled, flush, revision]);

  useEffect(() => {
    const handlePageHide = () => flush();
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      flush();
    };
  }, [flush]);

  return { flush, discardPending };
}
