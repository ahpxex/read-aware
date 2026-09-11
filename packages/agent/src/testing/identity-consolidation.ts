import { AppError, identityProfileContext, normalizeIdentityConsolidationPlan, type IdentityConsolidationPort, type IdentityConsolidationSnapshot, type ProfileContext } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type { EntityRegistryFixture } from "./entity-registry";

/** In-process source-change/commit fixture. Native tests own SQLite/HLC/outbox proof. */
export function createIdentityConsolidationFixture(deps: () => RuntimeDeps, registry: EntityRegistryFixture): IdentityConsolidationPort & { context(): Promise<ProfileContext> } {
  let derived: unknown = null, settled: string | null = null, sequence = 0;
  const readSources = async () => (await deps().memory.snapshotMemories()).filter(({ memory }) => (memory.scope === "user" || memory.scope === "global")
    && (memory.evidenceCount >= 3 || memory.pinned)).sort((a, b) => a.memory.id < b.memory.id ? -1 : a.memory.id > b.memory.id ? 1 : 0);
  const revision = async (snapshot: Omit<IdentityConsolidationSnapshot, "revision" | "settled">) => {
    const bytes = new TextEncoder().encode(JSON.stringify([snapshot.profile.revision, snapshot.entitiesRevision,
      snapshot.sources.map(source => [source.memory.id, source.revision]), snapshot.derived]));
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return `icg1:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")}`;
  };
  const snapshot: IdentityConsolidationPort["snapshot"] = async signal => {
    signal?.throwIfAborted();
    const value = { profile: { summary: await deps().profile.getProfileSummary() ?? null, revision: (await deps().profile.readProfile()).revision },
      entitiesRevision: (await registry.query()).revision, derived: structuredClone(derived),
      sources: await readSources() };
    const key = await revision(value);
    signal?.throwIfAborted();
    return { ...value, revision: key, settled: key === settled };
  };
  return { snapshot, context: async () => identityProfileContext({
    profile: { summary: await deps().profile.getProfileSummary() ?? null, revision: (await deps().profile.readProfile()).revision }, derived,
    sourceConditions: derived === null ? [] : (await readSources()).map(source => ({ memoryId: source.memory.id, revision: source.revision })),
  }), commit: async (raw, signal) => {
    const input = normalizeIdentityConsolidationPlan(raw), before = await snapshot(signal);
    const check = (current: IdentityConsolidationSnapshot) => {
      if (input.expectedRevision !== current.revision || input.entitiesRevision !== current.entitiesRevision
        || JSON.stringify(input.sources) !== JSON.stringify(current.sources.map(source => ({ memoryId: source.memory.id, revision: source.revision })))) {
        throw new AppError("memory/conflict", "Identity fixture source set changed");
      }
    };
    check(before);
    const nextRegistry = registry.fork(), emittedEventIds: string[] = [], entityEvidence = [];
    for (const decision of input.decisions) {
      const eventId = `fixture-entity-${++sequence}`;
      const result = await nextRegistry.decide({ ...decision.input, expectedRevision: (await nextRegistry.query()).revision }, signal);
      if (result.changed) emittedEventIds.push(eventId);
      entityEvidence.push({ eventId, memoryIds: decision.memoryIds });
    }
    const nextDerived = { version: 1, summary: input.summary, sources: input.sources, entityEvidence };
    if (JSON.stringify(nextDerived) !== JSON.stringify(derived)) emittedEventIds.push(`fixture-profile-${++sequence}`);
    const next = await revision({ ...before, derived: nextDerived, entitiesRevision: (await nextRegistry.query()).revision });
    check(await snapshot(signal));
    signal?.throwIfAborted();
    registry.adopt(nextRegistry, before.entitiesRevision);
    derived = nextDerived;
    settled = input.complete ? next : null;
    return { revision: next, emittedEventIds, settled: input.complete };
  } };
}
