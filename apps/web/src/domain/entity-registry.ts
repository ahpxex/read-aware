import { normalizeEntityDecision, normalizeEntityQuery,
  type EntityDecision, type EntityDecisionReceipt, type EntityPage, type EntityQuery, type EventOrigin } from "@read-aware/core";
import { invoke } from "../platform/ipc";
import { broadcastDomainEventDrafts, mintEventRows, type DomainEventDraft } from "../platform/domain-events";

type EntityHost = { invoke: typeof invoke; mint: typeof mintEventRows; broadcast: typeof broadcastDomainEventDrafts };

/** Native SQLite owns registry revisions, identity resolution and atomic writes. */
export function createEntityRegistryService(host: EntityHost) {
  return {
    query: async (input?: EntityQuery, signal?: AbortSignal): Promise<EntityPage> => {
      const query = normalizeEntityQuery(input);
      signal?.throwIfAborted();
      const page = await host.invoke<EntityPage>("entity_query", { query });
      signal?.throwIfAborted();
      return page;
    },
    decide: async (input: EntityDecision, origin: EventOrigin, signal?: AbortSignal): Promise<EntityDecisionReceipt> => {
      const decision = normalizeEntityDecision(input);
      signal?.throwIfAborted();
      const draft: DomainEventDraft = decision.op === "resolve"
        ? { type: "entity.resolved", origin, payload: { entityId: decision.entityId, kind: decision.kind,
          canonicalName: decision.canonicalName, ...(decision.aliases === undefined ? {} : { aliases: decision.aliases }) } }
        : { type: "entity.merged", origin, payload: { keepId: decision.keepId, mergedId: decision.mergedId } };
      const [event] = await host.mint([draft]);
      signal?.throwIfAborted();
      const receipt = await host.invoke<EntityDecisionReceipt>("entity_commit", { event, expectedRevision: decision.expectedRevision });
      // Once dispatched, cancellation cannot truthfully claim the transaction did not land.
      if (receipt.changed) host.broadcast([draft]);
      return receipt;
    },
  };
}

const service = createEntityRegistryService({ invoke, mint: mintEventRows, broadcast: broadcastDomainEventDrafts });
export const queryEntities = service.query;
export const decideEntity = service.decide;
