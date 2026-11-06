import type { DomainActor } from "../platform/domain-actor";
import { runDomainWrite } from "../platform/domain-write-gate";
import {
  normalizeUserProfileChange,
  normalizeUserProfileQuery,
  userProfilePage,
  type UserProfileChange,
  type UserProfileQuery,
  type UserProfileReceipt,
  type UserProfileSnapshot,
} from "@read-aware/core";
import { invoke } from "../platform/ipc";
import {
  broadcastDomainEventDrafts,
  mintEventRows,
  retryStampConflicts,
  type DomainEventDraft,
} from "../platform/domain-events";

export const LEGACY_PROFILE_KEY = "read-aware-agent-profile";
type ProfileHost = { invoke: typeof invoke; mint: typeof mintEventRows; broadcast: typeof broadcastDomainEventDrafts };

/** Initialization is shared housekeeping; actor cancellation only gates its own read/write. */
export function createUserProfileService(host: ProfileHost) {
  let initialization: Promise<void> | undefined;
  const initialize = (): Promise<void> =>
    (initialization ??= runDomainWrite(() =>
      retryStampConflicts(async () => {
        const [event] = await host.mint([{ type: "profile.updated", payload: {}, origin: "system" }]);
        const result = await host.invoke<{ migrated: boolean; snapshot: UserProfileSnapshot }>("profile_initialize", {
          event,
        });
        if (result.migrated)
          host.broadcast([
            { type: "profile.updated", payload: { summary: result.snapshot.summary }, origin: "system" },
          ]);
      }),
    ).catch((error) => {
      initialization = undefined;
      throw error;
    }));

  const readSnapshot = async (signal?: AbortSignal): Promise<UserProfileSnapshot> => {
    signal?.throwIfAborted();
    await initialize();
    signal?.throwIfAborted();
    const snapshot = await host.invoke<UserProfileSnapshot>("profile_inspect");
    signal?.throwIfAborted();
    return snapshot;
  };
  const change = async (input: UserProfileChange, origin: DomainActor, signal?: AbortSignal) => {
    const { summary, expectedRevision } = normalizeUserProfileChange(input);
    signal?.throwIfAborted();
    await initialize();
    signal?.throwIfAborted();
    const draft: DomainEventDraft = { type: "profile.updated", payload: { summary }, origin };
    return runDomainWrite(() =>
      retryStampConflicts(async () => {
        const [event] = await host.mint([draft]);
        signal?.throwIfAborted();
        const receipt = await host.invoke<UserProfileReceipt>("profile_commit", { event, expectedRevision });
        // Dispatched transactions drain to their real result, even if the actor retires.
        if (receipt.changed) host.broadcast([draft]);
        return receipt;
      }),
    );
  };
  return {
    initialize,
    readSnapshot,
    change,
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
  };
}

const service = createUserProfileService({ invoke, mint: mintEventRows, broadcast: broadcastDomainEventDrafts });
export const initializeUserProfile = service.initialize;
export const readUserProfileSnapshot = service.readSnapshot;
export const readUserProfile = service.read;
export const readUserProfilePage = service.page;
export const changeUserProfile = service.change;
export const putUserProfile = service.put;
