import type { ReadingContextPolicy } from "@read-aware/agent";
import { onLocalKVChange } from "../../../platform/local-store";
import { AI_PREFERENCES_KEY, getAIPreferences } from "../../settings/lib/ai-preferences";

export const readingContextPolicy: ReadingContextPolicy = {
  snapshot: () => {
    const preferences = getAIPreferences();
    return { selection: preferences.sendHighlightedText, surrounding: preferences.sendSurroundingContext };
  },
  subscribe: listener => onLocalKVChange(key => { if (key === AI_PREFERENCES_KEY) listener(); }),
};
