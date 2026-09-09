import type { MemoryBuildPolicy } from "@read-aware/agent";
import { onLocalKVChange } from "../../../platform/local-store";
import { AI_PREFERENCES_KEY, getAIPreferences } from "../../settings/lib/ai-preferences";

export const memoryPolicy: MemoryBuildPolicy = {
  enabled: () => getAIPreferences().buildMemory,
  subscribe: listener => onLocalKVChange(key => { if (key === AI_PREFERENCES_KEY) listener(); }),
};
