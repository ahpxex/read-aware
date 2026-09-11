import { AppError, normalizeEntityDecision, normalizeEntityQuery, type EntityDefinition, type EntityPage } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";

/** Agent fixture for explicit decisions, not native replay/checkpoint/hash evidence. */
type State = { definitions: Map<string, EntityDefinition>; aliases: Map<string, Set<string>>; roots: Map<string, string>; version: number };
export type EntityRegistryFixture = RuntimeDeps["entityRegistry"] & { fork(): EntityRegistryFixture; state(): State; adopt(other: EntityRegistryFixture, expectedRevision: string): void };
export function createEntityRegistryFixture(seed?: State): EntityRegistryFixture {
  let { definitions, aliases, roots, version } = structuredClone(seed ?? { definitions: new Map<string, EntityDefinition>(), aliases: new Map<string, Set<string>>(), roots: new Map<string, string>(), version: 0 });
  const revision = () => `entities1:${version.toString(16).padStart(64, "0")}`;
  const check = (expected?: string) => {
    if (expected !== undefined && expected !== revision()) throw new AppError("memory/conflict", "Entity registry changed");
  };
  const sort = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const lower = (text: string) => text.replace(/[A-Z]/g, char => char.toLowerCase());
  return {
    state: () => structuredClone({ definitions, aliases, roots, version }),
    fork: () => createEntityRegistryFixture({ definitions, aliases, roots, version }),
    adopt: (other, expectedRevision) => { check(expectedRevision); ({ definitions, aliases, roots, version } = other.state()); },
    query: async (raw, signal) => {
      const query = normalizeEntityQuery(raw); signal?.throwIfAborted(); check(query.expectedRevision);
      const canonicalId = query.kind === "identities" ? null : roots.get(query.entityId) ?? null;
      const canonicalDefinition = canonicalId ? definitions.get(canonicalId) ?? null : null;
      let items: EntityPage["items"];
      if (query.kind === "aliases") {
        items = [...aliases].flatMap(([entityId, names]) => roots.get(entityId) === canonicalId ? [...names].map(alias => ({ entityId, alias })) : [])
          .sort((a, b) => sort(a.alias, b.alias) || sort(a.entityId, b.entityId));
      } else {
        let ids = query.kind === "members" ? [...roots.keys()].filter(id => roots.get(id) === canonicalId) : [...new Set(roots.values())];
        if (query.kind === "identities" && query.search) {
          const search = lower(query.search);
          ids = ids.filter(root => [...roots].some(([member, target]) => target === root
            && [member, definitions.get(member)?.canonicalName ?? "", ...aliases.get(member) ?? []].some(value => lower(value).includes(search))));
        }
        items = ids.sort(sort).map(id => ({ id, definition: definitions.get(id) ?? null }));
      }
      if (query.offset > items.length) throw new AppError("memory/invalid-query", "Invalid entity offset");
      const page = { kind: query.kind, canonicalId, canonicalDefinition, items: items.slice(query.offset, query.offset + query.limit), total: items.length,
        offset: query.offset, nextOffset: query.offset + query.limit < items.length ? query.offset + query.limit : null, revision: revision() } as EntityPage;
      return structuredClone(page);
    },
    decide: async (raw, signal) => {
      const input = normalizeEntityDecision(raw); signal?.throwIfAborted(); check(input.expectedRevision);
      let changed = false;
      if (input.op === "resolve") {
        const old = definitions.get(input.entityId), names = aliases.get(input.entityId) ?? new Set<string>();
        const additions = [input.canonicalName, ...input.aliases ?? []];
        changed = !old || old.kind !== input.kind || old.canonicalName !== input.canonicalName || additions.some(name => !names.has(name));
        if (changed) {
          definitions.set(input.entityId, { kind: input.kind, canonicalName: input.canonicalName });
          aliases.set(input.entityId, new Set([...names, ...additions]));
          if (!roots.has(input.entityId)) roots.set(input.entityId, input.entityId);
        }
      } else {
        const keep = roots.get(input.keepId), merged = roots.get(input.mergedId);
        if (!keep || !merged || !definitions.has(keep) || !definitions.has(merged)) throw new AppError("memory/not-found", "Unknown identity class");
        changed = keep !== merged;
        if (changed) for (const [member, target] of roots) if (target === merged) roots.set(member, keep);
      }
      if (changed) version++;
      const entityId = input.op === "resolve" ? input.entityId : input.keepId;
      return { entityId, canonicalId: roots.get(entityId)!, changed, revision: revision() };
    },
  };
}
