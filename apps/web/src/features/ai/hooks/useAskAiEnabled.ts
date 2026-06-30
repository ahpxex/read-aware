import { useAtomValue } from "jotai";
import { aiPreferencesAtom } from "../../../state/ui";

/**
 * Whether the reader should offer "Ask AI about this". Gated on the user's
 * conversational-Q&A preference (Settings → AI), not on a configured API key —
 * replies flow through the response seam, so availability is a product choice,
 * not an infrastructure one.
 */
export function useAskAiEnabled(): boolean {
  return useAtomValue(aiPreferencesAtom).features.askConversation;
}
