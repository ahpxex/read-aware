import type { InferencePolicy } from "@read-aware/agent";
import { onLocalKVChange } from "../../../platform/local-store";
import { AI_PREFERENCES_KEY, getAIPreferences } from "../../settings/lib/ai-preferences";

/** No product-local inference backend exists; local-only denies all model calls. */
export const inferencePolicy: InferencePolicy = {
  localOnly: () => getAIPreferences().localOnly,
  subscribe: listener => onLocalKVChange(key => { if (key === AI_PREFERENCES_KEY) listener(); }),
};
