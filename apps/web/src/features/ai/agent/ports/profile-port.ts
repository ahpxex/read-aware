/** ProfilePort：user_profile_context v0（interim：localKV；目标：profile.updated 事件）。 */
import type { ProfilePort } from "@read-aware/agent";
import { normalizeUserProfileQuery, userProfilePage } from "@read-aware/core";
import { changeUserProfile, putUserProfile, readUserProfile } from "../../../../domain/user-profile";

export function createProfilePort(): ProfilePort {
  return {
    getProfileSummary: async () => readUserProfile(),
    readProfile: async (input, signal) => {
      const query = normalizeUserProfileQuery(input);
      signal?.throwIfAborted();
      const page = await userProfilePage(readUserProfile(), query);
      signal?.throwIfAborted();
      return page;
    },
    putProfileSummary: putUserProfile,
    updateProfile: (input, signal) => changeUserProfile(input, "agent", signal),
  };
}
