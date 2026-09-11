/** ProfilePort reads and edits the event-backed summary projection. */
import type { ProfilePort } from "@read-aware/agent";
import { changeUserProfile, putUserProfile, readUserProfile, readUserProfilePage } from "../../../../domain/user-profile";

export function createProfilePort(): ProfilePort {
  return {
    getProfileSummary: readUserProfile,
    readProfile: readUserProfilePage,
    putProfileSummary: putUserProfile,
    updateProfile: (input, signal) => changeUserProfile(input, "agent", signal),
  };
}
