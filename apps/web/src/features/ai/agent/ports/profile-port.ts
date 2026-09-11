/** ProfilePort reads and edits the event-backed summary projection. */
import type { ProfilePort } from "@read-aware/agent";
import { changeUserProfile, putUserProfile, readUserProfile, readUserProfilePage } from "../../../../domain/user-profile";
import { readProfileContext } from "../../../../domain/identity-consolidation";

export function createProfilePort(): ProfilePort {
  return {
    getProfileContext: readProfileContext,
    getProfileSummary: readUserProfile,
    readProfile: readUserProfilePage,
    putProfileSummary: putUserProfile,
    updateProfile: (input, signal) => changeUserProfile(input, "agent", signal),
  };
}
