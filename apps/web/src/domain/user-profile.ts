import { AppError, normalizeUserProfileChange, userProfilePage, type EventOrigin, type UserProfileChange, type UserProfileReceipt } from "@read-aware/core";
import { afterLocalKVWrites, localKV, setLocalKVBatch } from "../platform/local-store";

const PROFILE_KEY = "read-aware-agent-profile";
export const readUserProfile = () => localKV.getItem(PROFILE_KEY) ?? undefined;

/** Internal onboarding seed, not the conditional public write API. */
export const putUserProfile = (summary: string) => localKV.setItemAsync(PROFILE_KEY, summary);

export async function changeUserProfile(raw: UserProfileChange, origin: EventOrigin, signal?: AbortSignal): Promise<UserProfileReceipt> {
  const input = normalizeUserProfileChange(raw);
  signal?.throwIfAborted();
  const captured = await afterLocalKVWrites(readUserProfile);
  await userProfilePage(captured, { expectedRevision: input.expectedRevision, limit: 2 });
  const next = await userProfilePage(input.summary, { limit: 2 });
  const receipt: UserProfileReceipt = { changed: captured !== input.summary, revision: next.revision, persistence: "device-local" };
  return afterLocalKVWrites(() => {
    signal?.throwIfAborted();
    // Hashing is async. Recheck the captured value and enqueue without yielding,
    // after earlier UI/onboarding/restore writes have committed or rolled back.
    if (readUserProfile() !== captured) throw new AppError("memory/conflict", "Profile changed before saving");
    if (!receipt.changed) return receipt;
    return setLocalKVBatch(new Map([[PROFILE_KEY, input.summary]]), origin, "local", "caller").then(() => receipt);
  });
}
