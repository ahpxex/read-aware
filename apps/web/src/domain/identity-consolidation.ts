import { identityProfileContext, normalizeIdentityConsolidationPlan,
  type IdentityConsolidationPort, type IdentityConsolidationReceipt, type IdentityConsolidationSnapshot, type ProfileContextSnapshot } from "@read-aware/core";
import { invoke } from "../platform/ipc";
import { broadcastDomainEventDrafts, mintEventRows, type DomainEventDraft } from "../platform/domain-events";
import { createLogger } from "../platform/logger";
import { initializeUserProfile } from "./user-profile";

type IdentityHost = { invoke: typeof invoke; mint: typeof mintEventRows; broadcast: typeof broadcastDomainEventDrafts;
  initialize(): Promise<void>; warn(message: string): void };

/** Internal production port; neither model output nor a plugin chooses event authority. */
export function createIdentityConsolidationService(host: IdentityHost) {
  const snapshot: IdentityConsolidationPort["snapshot"] = async signal => {
    signal?.throwIfAborted();
    await host.initialize();
    signal?.throwIfAborted();
    const result = await host.invoke<IdentityConsolidationSnapshot>("identity_consolidation_snapshot");
    signal?.throwIfAborted();
    return result;
  };
  const commit: IdentityConsolidationPort["commit"] = async (raw, signal) => {
    const input = normalizeIdentityConsolidationPlan(raw);
    signal?.throwIfAborted();
    await host.initialize();
    signal?.throwIfAborted();
    const entityDrafts: DomainEventDraft[] = input.decisions.map(({ input: decision }) => decision.op === "resolve"
      ? { type: "entity.resolved", origin: "agent", payload: { entityId: decision.entityId, kind: decision.kind,
        canonicalName: decision.canonicalName, ...(decision.aliases === undefined ? {} : { aliases: decision.aliases }) } }
      : { type: "entity.merged", origin: "agent", payload: { keepId: decision.keepId, mergedId: decision.mergedId } });
    const entityEvents = entityDrafts.length ? await host.mint(entityDrafts) : [];
    signal?.throwIfAborted();
    const profileDraft: DomainEventDraft = { type: "profile.updated", origin: "agent", payload: { traits: { consolidated: {
      version: 1, summary: input.summary, sources: input.sources,
      entityEvidence: entityEvents.map((event, index) => ({ eventId: event.id, memoryIds: input.decisions[index]!.memoryIds })),
    } } } };
    // Profile provenance needs minted entity IDs and must follow their HLCs.
    const [profileEvent] = await host.mint([profileDraft]);
    signal?.throwIfAborted();
    const receipt = await host.invoke<IdentityConsolidationReceipt>("identity_consolidation_commit", {
      expectedRevision: input.expectedRevision, profileEvent, entityEvents, complete: input.complete,
    });
    // Dispatch owns the actual result, including when cancellation arrives meanwhile.
    const emitted = new Set(receipt.emittedEventIds);
    const events = [...entityEvents, profileEvent!];
    const changed = [...entityDrafts, profileDraft].filter((_, index) => emitted.has(events[index]!.id));
    if (changed.length) host.broadcast(changed);
    return receipt;
  };
  return { snapshot, commit, context: async (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    await host.initialize();
    signal?.throwIfAborted();
    const observed = await host.invoke<ProfileContextSnapshot>("profile_context");
    signal?.throwIfAborted();
    const result = identityProfileContext(observed);
    if (result.derivedStatus === "invalid") host.warn("Invalid consolidated profile omitted from context");
    return result;
  } };
}

const service = createIdentityConsolidationService({ invoke, mint: mintEventRows, broadcast: broadcastDomainEventDrafts,
  initialize: initializeUserProfile, warn: message => createLogger("identity-consolidation").warn(message) });
export const identityConsolidationPort: IdentityConsolidationPort = { snapshot: service.snapshot, commit: service.commit };
export const readProfileContext = service.context;
