/**
 * Clipboard write + transient "copied" feedback for per-message copy actions.
 * The timer resets on rapid re-copy and is cleaned up on unmount.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export function useCopyToClipboard(resetMs = 1500): {
  copied: boolean;
  copy: (text: string) => Promise<void>;
} {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setCopied(false), resetMs);
      } catch {
        // Clipboard can be unavailable outside a trusted gesture — stay quiet.
      }
    },
    [resetMs],
  );

  return { copied, copy };
}
