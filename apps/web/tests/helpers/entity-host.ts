import type { EntityDecisionReceipt, EntityPage } from "@read-aware/core";
import { createEntityRegistryService } from "../../src/domain/entity-registry";
import type { DomainEventDraft } from "../../src/platform/domain-events";

export const entityRevision = `entities1:${"a".repeat(64)}`;
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** Scripted IPC responses, not a second implementation of native entity semantics. */
export function entityHost() {
  const calls: { command: string; args: unknown }[] = [], broadcasts: DomainEventDraft[] = [], minted: DomainEventDraft[] = [];
  const controls = {
    page: { kind: "identities", canonicalId: null, items: [], offset: 0, nextOffset: null, total: 0, revision: entityRevision } as EntityPage,
    receipt: { entityId: "one", canonicalId: "one", changed: true, revision: `entities1:${"b".repeat(64)}` } as EntityDecisionReceipt,
    beforeMint: async () => {}, beforeRead: async () => {}, beforeCommit: async () => {},
  };
  const service = createEntityRegistryService({
    mint: async drafts => {
      minted.push(...structuredClone(drafts));
      await controls.beforeMint();
      return drafts.map(draft => ({ ...draft, id: "event", hlc: { wallMs: 1, counter: 0, deviceId: "test" },
        aggregateType: "entity", aggregateId: draft.type === "entity.resolved" ? draft.payload.entityId
          : draft.type === "entity.merged" ? draft.payload.keepId : undefined }));
    },
    broadcast: drafts => { broadcasts.push(...structuredClone(drafts)); },
    invoke: async <T>(command: string, args?: unknown): Promise<T> => {
      calls.push({ command, args: structuredClone(args) });
      if (command === "entity_query") { await controls.beforeRead(); return structuredClone(controls.page) as T; }
      if (command === "entity_commit") { await controls.beforeCommit(); return structuredClone(controls.receipt) as T; }
      throw Error(`Unexpected IPC ${command}`);
    },
  });
  return { service, calls, broadcasts, minted, controls };
}
