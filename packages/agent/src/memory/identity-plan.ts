import { AppError, normalizeIdentityConsolidationPlan, type IdentityConsolidationPlan, type IdentityConsolidationSnapshot } from "@read-aware/core";
import type { IdentityInput } from "./identity-input";

const invalid = (): never => { throw new AppError("memory/invalid-input", "Invalid identity inference result"); };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));

async function newId(kind: string, name: string, memoryIds: string[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([kind, name, [...memoryIds].sort()]));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `auto-entity:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Model IDs are references, not authority to overwrite an unseen registry row. */
export async function identityPlan(raw: string, snapshot: IdentityConsolidationSnapshot, input: IdentityInput): Promise<IdentityConsolidationPlan> {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return invalid(); /* Strict JSON only; incomplete prose is not a successful no-op. */ }
  if (!object(parsed) || !exact(parsed, ["summary", "complete", "resolutions", "merges"]) || typeof parsed.summary !== "string"
    || typeof parsed.complete !== "boolean" || !Array.isArray(parsed.resolutions) || !Array.isArray(parsed.merges)
    || parsed.resolutions.length + parsed.merges.length > 32) return invalid();
  const known = new Set(input.identities.flatMap(group => [group.id, ...group.members.map(member => member.id)]));
  const roots = new Set(input.identities.filter(group => group.definition !== null).map(group => group.id));
  const eligible = new Set(snapshot.sources.map(source => source.memory.id));
  const evidence = (value: unknown): string[] => {
    if (!Array.isArray(value) || !value.length || value.some(id => typeof id !== "string" || !eligible.has(id)) || new Set(value).size !== value.length) return invalid();
    return [...value] as string[];
  };
  const decisions: IdentityConsolidationPlan["decisions"] = [], resolved = new Set<string>(), merged = new Set<string>();
  for (const value of parsed.resolutions) {
    if (!object(value) || !exact(value, ["entityId", "kind", "canonicalName", "aliases", "memoryIds"])
      || typeof value.kind !== "string" || typeof value.canonicalName !== "string" || !Array.isArray(value.aliases)
      || value.entityId !== null && (typeof value.entityId !== "string" || !known.has(value.entityId))) return invalid();
    const memoryIds = evidence(value.memoryIds);
    const entityId = value.entityId === null ? await newId(value.kind, value.canonicalName, memoryIds) : value.entityId as string;
    // A collision must be reviewed against the visible identity, never overwritten as "new".
    if (resolved.has(entityId) || value.entityId === null && known.has(entityId)) return invalid();
    resolved.add(entityId);
    decisions.push({ memoryIds, input: { op: "resolve", expectedRevision: snapshot.entitiesRevision, entityId,
      kind: value.kind, canonicalName: value.canonicalName, aliases: value.aliases as string[] } });
  }
  for (const value of parsed.merges) {
    if (!object(value) || !exact(value, ["keepId", "mergedId", "memoryIds"]) || typeof value.keepId !== "string" || typeof value.mergedId !== "string"
      || value.keepId === value.mergedId || !roots.has(value.keepId) || !roots.has(value.mergedId)
      || merged.has(value.keepId) || merged.has(value.mergedId)) return invalid();
    merged.add(value.keepId); merged.add(value.mergedId);
    decisions.push({ memoryIds: evidence(value.memoryIds), input: { op: "merge", expectedRevision: snapshot.entitiesRevision,
      keepId: value.keepId, mergedId: value.mergedId } });
  }
  return normalizeIdentityConsolidationPlan({ expectedRevision: snapshot.revision, entitiesRevision: snapshot.entitiesRevision,
    summary: parsed.summary, complete: parsed.complete, sources: snapshot.sources.map(source => ({ memoryId: source.memory.id, revision: source.revision })), decisions });
}
