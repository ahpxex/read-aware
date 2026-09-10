/** ProfilePort：user_profile_context v0（interim：localKV；目标：profile.updated 事件）。 */
import type { ProfilePort } from "@read-aware/agent";
import { normalizeUserProfileQuery, userProfilePage } from "@read-aware/core";
import { localKV } from "../../../../platform/local-store";

const PROFILE_KEY = "read-aware-agent-profile";

export function createProfilePort(): ProfilePort {
  const read = () => localKV.getItem(PROFILE_KEY) ?? undefined;
  return {
    getProfileSummary: async () => read(),
    readProfile: async (input, signal) => {
      const query = normalizeUserProfileQuery(input);
      signal?.throwIfAborted();
      const page = await userProfilePage(read(), query);
      signal?.throwIfAborted();
      return page;
    },
    putProfileSummary: async (summary) => {
      await localKV.setItemAsync(PROFILE_KEY, summary);
    },
  };
}
