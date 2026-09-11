import { AppError } from "./errors";

export type EntityDefinition = { kind: string; canonicalName: string };
export type EntityIdentity = { id: string; definition: EntityDefinition | null };
export type EntityAlias = { entityId: string; alias: string };
type EntityPaging = { offset?: number; limit?: number; expectedRevision?: string };
export type EntityQuery = EntityPaging & (
  | { kind: "identities"; search?: string }
  | { kind: "members" | "aliases"; entityId: string }
);
type EntityPageBase = { canonicalId: string | null; canonicalDefinition: EntityDefinition | null; offset: number; nextOffset: number | null; total: number; revision: string };
export type EntityPage = EntityPageBase & (
  | { kind: "identities" | "members"; items: EntityIdentity[] }
  | { kind: "aliases"; items: EntityAlias[] }
);
export type EntityDecision = { expectedRevision: string } & (
  | { op: "resolve"; entityId: string; kind: string; canonicalName: string; aliases?: string[] }
  | { op: "merge"; keepId: string; mergedId: string }
);
export type EntityDecisionReceipt = { entityId: string; canonicalId: string; changed: boolean; revision: string };

const validRevision = (value: unknown): value is string => typeof value === "string" && /^entities1:[a-f0-9]{64}$/.test(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && !!value.trim() && value.length <= max;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Literal identity search; continuation tokens describe the whole registry. */
export function normalizeEntityQuery(input: EntityQuery = { kind: "identities" }): EntityQuery & { offset: number; limit: number } {
  const fail = (): never => { throw new AppError("memory/invalid-query", "Invalid entity registry query"); };
  if (!record(input) || !["identities", "members", "aliases"].includes(input.kind)) return fail();
  const extra = input.kind === "identities" ? "search" : "entityId";
  if (Object.keys(input).some(key => !["kind", "offset", "limit", "expectedRevision", extra].includes(key))) return fail();
  const offset = input.offset === undefined ? 0 : input.offset, limit = input.limit === undefined ? 25 : input.limit;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100
    || input.expectedRevision !== undefined && !validRevision(input.expectedRevision)
    || offset > 0 && input.expectedRevision === undefined) return fail();
  const paging = { offset, limit, ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }) };
  if (input.kind === "identities") {
    if (input.search !== undefined && (typeof input.search !== "string" || input.search.length > 128)) return fail();
    return { ...paging, kind: input.kind, ...(input.search === undefined ? {} : { search: input.search }) };
  }
  if (!text(input.entityId, 256)) return fail();
  return { ...paging, kind: input.kind, entityId: input.entityId };
}

/** Copy a bounded candidate before async approval or IPC; aliases retain their spelling. */
export function normalizeEntityDecision(input: EntityDecision): EntityDecision {
  const fail = (): never => { throw new AppError("memory/invalid-input", "Invalid conditional entity decision"); };
  if (!record(input) || !validRevision(input.expectedRevision)) return fail();
  if (input.op === "merge") {
    if (Object.keys(input).some(key => !["op", "keepId", "mergedId", "expectedRevision"].includes(key))
      || !text(input.keepId, 256) || !text(input.mergedId, 256)) return fail();
    return { op: input.op, keepId: input.keepId, mergedId: input.mergedId, expectedRevision: input.expectedRevision };
  }
  if (input.op !== "resolve" || Object.keys(input).some(key => !["op", "entityId", "kind", "canonicalName", "aliases", "expectedRevision"].includes(key))
    || !text(input.entityId, 256) || !text(input.kind, 64) || !text(input.canonicalName, 512)
    || input.aliases !== undefined && (!Array.isArray(input.aliases) || input.aliases.length > 32 || Array.from(input.aliases).some(alias => !text(alias, 512)))) return fail();
  return { op: input.op, entityId: input.entityId, kind: input.kind, canonicalName: input.canonicalName,
    ...(input.aliases === undefined ? {} : { aliases: [...input.aliases] }), expectedRevision: input.expectedRevision };
}
