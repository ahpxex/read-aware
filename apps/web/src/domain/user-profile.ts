import { normalizeUserProfileChange, normalizeUserProfileQuery, userProfilePage,
  type EventOrigin, type UserProfileChange, type UserProfileQuery, type UserProfileReceipt, type UserProfileSnapshot } from "@read-aware/core";
import { invoke } from "../platform/ipc";
import { broadcastDomainEventDrafts, mintEventRows, type DomainEventDraft } from "../platform/domain-events";

export const LEGACY_PROFILE_KEY = "read-aware-agent-profile";
type ProfileHost = { invoke: typeof invoke; mint: typeof mintEventRows; broadcast: typeof broadcastDomainEventDrafts };

/** Initialization is shared housekeeping; actor cancellation only gates its own read/write. */
export function createUserProfileService(host: ProfileHost) {
  let initialization: Promise<void> | undefined;
  const initialize = (): Promise<void> => initialization ??= (async () => {
    const [event] = await host.mint([{ type: "profile.updated", payload: {}, origin: "system" }]);
    const result = await host.invoke<{ migrated: boolean; snapshot: UserProfileSnapshot }>("profile_initialize", { event });
    if (result.migrated) host.broadcast([{ type: "profile.updated", payload: { summary: result.snapshot.summary }, origin: "system" }]);
  })().catch(error => { initialization = undefined; throw error; });

  const readSnapshot = async (signal?: AbortSignal): Promise<UserProfileSnapshot> => {
    signal?.throwIfAborted();
    await initialize();
    signal?.throwIfAborted();
    const snapshot = await host.invoke<UserProfileSnapshot>("profile_inspect");
    signal?.throwIfAborted();
    return snapshot;
  };
  const write = async (command: "profile_commit" | "profile_restore", input: UserProfileChange, origin: EventOrigin, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    await initialize();
    signal?.throwIfAborted();
    const draft: DomainEventDraft = { type: "profile.updated", payload: { summary: input.summary }, origin };
    const [event] = await host.mint([draft]);
    signal?.throwIfAborted();
    const receipt = await host.invoke<UserProfileReceipt>(command, { event, expectedRevision: input.expectedRevision });
    // Dispatched transactions drain to their real result, even if the actor retires.
    if (receipt.changed) host.broadcast([draft]);
    return receipt;
  };
  const change = async (input: UserProfileChange, origin: EventOrigin, signal?: AbortSignal) =>
    write("profile_commit", normalizeUserProfileChange(input), origin, signal);
  return {
    initialize, readSnapshot, change,
    read: async () => (await readSnapshot()).summary ?? undefined,
    page: async (input?: UserProfileQuery, signal?: AbortSignal) => {
      const query = normalizeUserProfileQuery(input);
      const page = await userProfilePage(await readSnapshot(signal), query);
      signal?.throwIfAborted();
      return page;
    },
    put: async (summary: string) => {
      const observed = await readSnapshot();
      await change({ summary, expectedRevision: observed.revision }, "agent");
    },
    // Only the host archive workflow can reach this; no override flag in public edits.
    restore: (summary: string, expectedRevision: string) => write("profile_restore", { summary, expectedRevision }, "user"),
  };
}

const service = createUserProfileService({ invoke, mint: mintEventRows, broadcast: broadcastDomainEventDrafts });
export const initializeUserProfile = service.initialize;
export const readUserProfileSnapshot = service.readSnapshot;
export const readUserProfile = service.read;
export const readUserProfilePage = service.page;
export const changeUserProfile = service.change;
export const putUserProfile = service.put;
export const restoreUserProfile = service.restore;
