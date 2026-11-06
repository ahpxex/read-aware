import type { DomainActor } from "../platform/domain-actor";
import { runDomainWrite } from "../platform/domain-write-gate";
import { AppError, normalizeOnboardingChange, type OnboardingChange, type OnboardingReceipt } from "@read-aware/core";
import { invoke } from "../platform/ipc";
import {
  broadcastDomainEventDrafts,
  mintEventRows,
  retryStampConflicts,
  type DomainEventDraft,
} from "../platform/domain-events";
import { initializeUserProfile } from "./user-profile";
import { getAIPreferences } from "../features/settings/lib/ai-preferences";

type Host = {
  allowed(): boolean;
  initialize(): Promise<void>;
  invoke: typeof invoke;
  mint: typeof mintEventRows;
  broadcast: typeof broadcastDomainEventDrafts;
};
export function createOnboardingService(host: Host) {
  return async (input: OnboardingChange, origin: DomainActor, signal?: AbortSignal): Promise<OnboardingReceipt> => {
    const accepted = normalizeOnboardingChange(input);
    const allowed = () => {
      if (!host.allowed()) throw new AppError("ai/memory-disabled", "Building memory is disabled");
    };
    allowed();
    signal?.throwIfAborted();
    await host.initialize();
    signal?.throwIfAborted();
    const draft: DomainEventDraft = { type: "profile.onboarded", payload: accepted, origin };
    return runDomainWrite(() =>
      retryStampConflicts(async () => {
        const [event] = await host.mint([draft]);
        signal?.throwIfAborted();
        allowed();
        const receipt = await host.invoke<OnboardingReceipt>("onboarding_commit", { event });
        // A lost reply can be retried with the same candidate/id. It acknowledges
        // the original commit, not the current profile, and emits no second change.
        if (receipt.status === "completed") host.broadcast([draft]);
        return receipt;
      }),
    );
  };
}

export const completeOnboarding = createOnboardingService({
  allowed: () => getAIPreferences().buildMemory,
  initialize: initializeUserProfile,
  invoke,
  mint: mintEventRows,
  broadcast: broadcastDomainEventDrafts,
});
