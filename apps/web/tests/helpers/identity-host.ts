import type { IdentityConsolidationPlan, IdentityConsolidationReceipt, IdentityConsolidationSnapshot } from "@read-aware/core";
import { createIdentityConsolidationService } from "../../src/domain/identity-consolidation";
import type { DomainEventDraft } from "../../src/platform/domain-events";

export const identityRevision = `icg1:${"a".repeat(64)}`, registryRevision = `entities1:${"a".repeat(64)}`;
export function identityPlan(): IdentityConsolidationPlan {
  return { expectedRevision: identityRevision, entitiesRevision: registryRevision, summary: "Derived", complete: true,
    sources: [{ memoryId: "a", revision: `mem1:${"a".repeat(64)}` }], decisions: [
      { input: { op: "resolve", entityId: "a", kind: "person", canonicalName: "Alex", aliases: ["A"], expectedRevision: registryRevision }, memoryIds: ["a"] },
      { input: { op: "merge", keepId: "a", mergedId: "b", expectedRevision: registryRevision }, memoryIds: ["a"] },
    ] };
}

/** Scripted IPC only. Rust tests, not this helper, prove native CAS and rollback. */
export function identityHost() {
  const calls: { command: string; args: unknown }[] = [], minted: DomainEventDraft[] = [], broadcasts: DomainEventDraft[] = [], warnings: string[] = [];
  let counter = 0, initialized = 0;
  const controls = {
    snapshot: { revision: identityRevision, entitiesRevision: registryRevision, profile: { summary: "Curated", revision: `profile2:${"a".repeat(64)}` },
      derived: null, settled: false, sources: [{ revision: `mem1:${"a".repeat(64)}`, memory: { id: "a", scope: "user", kind: "fact", content: "Source",
        importance: 0.5, evidenceCount: 3, status: "active", createdAt: "old", updatedAt: "old" } }] } as IdentityConsolidationSnapshot,
    receipt: { revision: `icg1:${"b".repeat(64)}`, emittedEventIds: ["event-1", "event-3"], settled: true } as IdentityConsolidationReceipt,
    beforeInitialize: async () => {}, beforeMint: async () => {}, beforeRead: async () => {}, beforeCommit: async () => {},
  };
  const service = createIdentityConsolidationService({
    initialize: async () => { initialized++; await controls.beforeInitialize(); },
    warn: message => { warnings.push(message); },
    mint: async drafts => {
      minted.push(...structuredClone(drafts));
      await controls.beforeMint();
      return drafts.map(draft => ({ ...draft, id: `event-${++counter}`, hlc: { wallMs: 1, counter, deviceId: "test" },
        ...(draft.type === "profile.updated" ? {} : { aggregateType: "entity", aggregateId: draft.type === "entity.resolved" ? draft.payload.entityId
          : draft.type === "entity.merged" ? draft.payload.keepId : undefined }) }));
    },
    broadcast: drafts => { broadcasts.push(...structuredClone(drafts)); },
    invoke: async <T>(command: string, args?: unknown): Promise<T> => {
      calls.push({ command, args: structuredClone(args) });
      if (command === "identity_consolidation_snapshot") { await controls.beforeRead(); return structuredClone(controls.snapshot) as T; }
      if (command === "profile_context") {
        await controls.beforeRead();
        const value = controls.snapshot;
        return structuredClone({ profile: value.profile, derived: value.derived,
          sourceConditions: value.sources.map(source => ({ memoryId: source.memory.id, revision: source.revision })) }) as T;
      }
      if (command === "identity_consolidation_commit") { await controls.beforeCommit(); return structuredClone(controls.receipt) as T; }
      throw Error(`Unexpected IPC ${command}`);
    },
  });
  return { service, controls, calls, minted, broadcasts, warnings, initialized: () => initialized };
}
