/**
 * Drives an AI dictionary look-up for the reader modal. Owns the async lifecycle
 * (unconfigured / loading / ready / error) and re-runs whenever the source text,
 * context, or explanation language changes. Words and short phrases get a
 * dictionary entry (`lookUpWord`); whole sentences get a translation plus
 * per-word glosses (`explainSentence`) — `isSentenceLookup` decides. Uses the
 * same BYOK provider stack as chat via `accountFromConfig`; the *fast* tier does
 * the work. No network client of its own.
 */
import { useEffect, useRef, useState } from "react";
import {
  explainSentence,
  isSentenceLookup,
  lookUpWord,
  type DictionaryLookupResult,
} from "@read-aware/agent";
import { getAIConfig } from "../../ai/lib/ai-config";
import { accountFromConfig } from "../../ai/agent/account";
import { getCachedLookup, putCachedLookup } from "../lib/dictionary-cache";

export type DictionaryLookupState =
  | { status: "idle" }
  | { status: "unconfigured" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: DictionaryLookupResult };

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
      const cached = getCachedLookup(term, explanationLanguage, context);
      if (cached) {
        setState({ status: "ready", result: cached });
        return;
      }
    }

    let cancelled = false;
    setState({ status: "loading" });

    const { account, models } = accountFromConfig(config);
    const generate: Promise<DictionaryLookupResult> = isSentenceLookup(term)
      ? explainSentence(account, models, { sentence: term, bookTitle, explanationLanguage }).then(
          (explanation) => ({ kind: "sentence", explanation }),
        )
      : lookUpWord(account, models, { term, context, bookTitle, explanationLanguage }).then(
          (entry) => ({ kind: "term", entry }),
        );

    generate
      .then((result) => {
        if (cancelled) return;
        putCachedLookup(term, explanationLanguage, context, result);
        setState({ status: "ready", result });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Surface the real failure — the modal shows a generic line, and a
        // swallowed provider/parse error is undiagnosable.
        console.error("Dictionary lookup failed:", error);
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
