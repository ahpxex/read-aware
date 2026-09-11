import { useEffect, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { AppError, READING_AI_ACTIONS, type ReadingAiAction } from "@read-aware/core";
import { useToast } from "@read-aware/ui";
import { aiPreferencesAtom } from "../../../state/ui";
import { readingRuntime } from "../../../domain/reading-runtime";
import { readingAiActions } from "../../../services/reading-ai-runtime";
import { createLogger } from "../../../platform/logger";
import { describeError } from "../../../i18n";

const log = createLogger("reading-ai-action");
export function useReadingAiControls(active: boolean, selectionId?: string | null) {
  const preferences = useAtomValue(aiPreferencesAtom), { toast } = useToast();
  const [session, setSession] = useState(() => readingRuntime.snapshot());
  useEffect(() => active ? readingRuntime.observe(setSession) : undefined, [active]);
  return useMemo(() => ({
    actions: READING_AI_ACTIONS.filter(action => preferences.features[action] === true),
    disabled: (action: ReadingAiAction) => session.status !== "ready" || preferences.localOnly
      || (action === "summarizeChapter" ? !preferences.sendSurroundingContext || !session.location?.href
        : !preferences.sendHighlightedText || !session.selection?.text.trim()
          || selectionId !== undefined && selectionId !== session.selection?.id),
    run: async (action: ReadingAiAction, signal?: AbortSignal) => {
      if (action !== "summarizeChapter" && selectionId !== undefined && selectionId !== readingRuntime.snapshot().selection?.id) {
        throw new AppError("reader/superseded", "Selection menu target changed");
      }
      return readingAiActions.run(action, undefined, signal);
    },
    report: (error: unknown) => {
      log.warn("Reading AI action failed", error);
      toast({ variant: "destructive", description: describeError(error).body });
    },
  }), [preferences, session, selectionId, toast]);
}
