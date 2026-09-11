import { AppError, normalizeUserProfileChange, userProfilePage, userProfileRevision } from "@read-aware/core";
import type { ProfilePort } from "../ports";

export function createProfileFixture(state: { summary: string | undefined }): ProfilePort {
  let eventId: string | null = state.summary === undefined ? null : crypto.randomUUID();
  const snapshot = async () => {
    const summary = state.summary ?? null, event = eventId;
    return { summary, revision: await userProfileRevision(summary, event) };
  };
  const updateProfile: ProfilePort["updateProfile"] = async (raw, signal) => {
    const input = normalizeUserProfileChange(raw), captured = state.summary, capturedEvent = eventId;
    const revision = await userProfileRevision(captured ?? null, capturedEvent);
    if (revision !== input.expectedRevision) throw new AppError("memory/conflict", "Profile changed");
    const changed = captured !== input.summary, nextEvent = changed ? crypto.randomUUID() : capturedEvent;
    const nextRevision = await userProfileRevision(input.summary, nextEvent);
    signal?.throwIfAborted();
    if (state.summary !== captured || eventId !== capturedEvent) throw new AppError("memory/conflict", "Profile changed");
    if (changed) { state.summary = input.summary; eventId = nextEvent; }
    return { changed, revision: nextRevision, persistence: "event-log" };
  };
  return {
    getProfileContext: async () => ({ curated: state.summary ?? null, consolidated: null, derivedStatus: "absent" }),
    updateProfile,
    getProfileSummary: async () => state.summary,
    readProfile: async (query, signal) => {
      signal?.throwIfAborted();
      const result = await userProfilePage(await snapshot(), query);
      signal?.throwIfAborted();
      return result;
    },
    putProfileSummary: async summary => { await updateProfile({ summary, expectedRevision: (await snapshot()).revision }); },
  };
}
