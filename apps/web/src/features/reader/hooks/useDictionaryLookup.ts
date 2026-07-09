/**
 * Drives an AI dictionary look-up for the reader modal. Owns the async lifecycle
 * (unconfigured / loading / ready / error) and re-runs whenever the term,
 * context, or explanation language changes. Uses the same BYOK provider stack as
 * chat via `accountFromConfig`; the *fast* tier does the work (see the agent
 * package's `lookUpWord`). No network client of its own.
 */
import { useEffect, useRef, useState } from "react";
import { lookUpWord, type DictionaryEntry } from "@read-aware/agent";
import { getAIConfig } from "../../ai/lib/ai-config";
import { accountFromConfig } from "../../ai/agent/account";
import { getCachedEntry, putCachedEntry } from "../lib/dictionary-cache";

export type DictionaryLookupState =
  | { status: "idle" }
  | { status: "unconfigured" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entry: DictionaryEntry };

export interface DictionaryLookupArgs {
  open: boolean;
  term: string;
  context?: string;
  bookTitle?: string;
  /** Human-readable language name for the model (e.g. "Simplified Chinese"). */
  explanationLanguage: string;
}

export function useDictionaryLookup(args: DictionaryLookupArgs): {
  state: DictionaryLookupState;
  /** Force a fresh generation, bypassing (and overwriting) the cache. */
  regenerate: () => void;
} {
  const { open, term, context, bookTitle, explanationLanguage } = args;
  const [state, setState] = useState<DictionaryLookupState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  // Set by regenerate() and consumed by the next run, so a plain input change
  // (new word) still reads the cache while an explicit regenerate skips it.
  const forceRef = useRef(false);

  useEffect(() => {
    const force = forceRef.current;
    forceRef.current = false;

    if (!open || !term.trim()) {
      setState({ status: "idle" });
      return;
    }

    const config = getAIConfig();
    if (!config?.apiKey) {
      setState({ status: "unconfigured" });
      return;
    }

    if (!force) {
      const cached = getCachedEntry(term, explanationLanguage, context);
      if (cached) {
        setState({ status: "ready", entry: cached });
        return;
      }
    }

    let cancelled = false;
    setState({ status: "loading" });

    const { account, models } = accountFromConfig(config);
    lookUpWord(account, models, { term, context, bookTitle, explanationLanguage })
      .then((entry) => {
        if (cancelled) return;
        putCachedEntry(term, explanationLanguage, context, entry);
        setState({ status: "ready", entry });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "lookup failed",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [open, term, context, bookTitle, explanationLanguage, attempt]);

  return {
    state,
    regenerate: () => {
      forceRef.current = true;
      setAttempt((n) => n + 1);
    },
  };
}
