/** ProfilePort：user_profile_context v0（interim：localKV；目标：profile.updated 事件）。 */
import type { ProfilePort } from "@read-aware/agent";
import { localKV } from "../../../../platform/local-store";

const PROFILE_KEY = "read-aware-agent-profile";

export function createProfilePort(): ProfilePort {
  return {
    getProfileSummary: async () => localKV.getItem(PROFILE_KEY) ?? undefined,
    putProfileSummary: async (summary) => {
      localKV.setItem(PROFILE_KEY, summary);
    },
  };
}
