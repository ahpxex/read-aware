import { AppError } from "./errors";
import { normalizeEntityDecision, type EntityDecision } from "./entity-registry";
import type { MemorySnapshot } from "./memory-management";
import type { UserProfileSnapshot } from "./user-profile";

export type IdentitySource = { memoryId: string; revision: string };
export type IdentityConsolidationSnapshot = {
  revision: string;
  profile: UserProfileSnapshot;
  derived: unknown;
  entitiesRevision: string;
  sources: MemorySnapshot[];
  settled: boolean;
};
export type IdentityConsolidationPlan = {
  expectedRevision: string;
  entitiesRevision: string;
  summary: string;
  sources: IdentitySource[];
  decisions: { input: EntityDecision; memoryIds: string[] }[];
  complete: boolean;
};
export type IdentityConsolidationReceipt = { revision: string; emittedEventIds: string[]; settled: boolean };
export type IdentityConsolidationPort = {
  snapshot(signal?: AbortSignal): Promise<IdentityConsolidationSnapshot>;
  commit(input: IdentityConsolidationPlan, signal?: AbortSignal): Promise<IdentityConsolidationReceipt>;
};
export type ConsolidatedProfile = {
  version: 1;
  summary: string;
  sources: IdentitySource[];
  /** Proposed IDs include no-ops; only commit receipts prove emission. */
  entityEvidence: { eventId: string; memoryIds: string[] }[];
};
export type ProfileContext = {
  curated: string | null;
  consolidated: ConsolidatedProfile | null;
  derivedStatus: "absent" | "current" | "stale" | "invalid";
};
export type ProfileContextSnapshot = {
  profile: UserProfileSnapshot;
  derived: unknown;
  sourceConditions: IdentitySource[];
};

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const fields = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const token = (value: unknown, prefix: string): value is string => typeof value === "string" && new RegExp(`^${prefix}:[a-f0-9]{64}$`).test(value);
const invalid = (): never => { throw new AppError("memory/invalid-input", "Invalid identity consolidation plan"); };

function sources(value: unknown): IdentitySource[] {
  if (!Array.isArray(value)) return invalid();
  const seen = new Set<string>();
  // Historical IDs and read-set size are not bounded by new-write limits.
  return Array.from(value, item => {
    if (!record(item) || !fields(item, ["memoryId", "revision"]) || typeof item.memoryId !== "string"
      || !item.memoryId || seen.has(item.memoryId) || !token(item.revision, "mem1")) return invalid();
    seen.add(item.memoryId);
    return { memoryId: item.memoryId, revision: item.revision };
  });
}
function evidenceIds(value: unknown, eligible: Set<string>): string[] {
  if (!Array.isArray(value) || !value.length || value.length > eligible.size) return invalid();
  const seen = new Set<string>();
  return Array.from(value, id => {
    if (typeof id !== "string" || !eligible.has(id) || seen.has(id)) return invalid();
    seen.add(id);
    return id;
  });
}

/** Capture the full plan before initialization, minting, approval or any IPC. */
export function normalizeIdentityConsolidationPlan(input: IdentityConsolidationPlan): IdentityConsolidationPlan {
  if (!record(input) || !fields(input, ["expectedRevision", "entitiesRevision", "summary", "sources", "decisions", "complete"])
    || !token(input.expectedRevision, "icg1") || !token(input.entitiesRevision, "entities1")
    || typeof input.summary !== "string" || input.summary.length > 16_000 || typeof input.complete !== "boolean"
    || !Array.isArray(input.decisions) || input.decisions.length > 32) return invalid();
  const captured = sources(input.sources), eligible = new Set(captured.map(source => source.memoryId));
  const decisions = Array.from(input.decisions, item => {
    if (!record(item) || !fields(item, ["input", "memoryIds"])) return invalid();
    const decision = normalizeEntityDecision(item.input as EntityDecision);
    if (decision.expectedRevision !== input.entitiesRevision) return invalid();
    return { input: decision, memoryIds: evidenceIds(item.memoryIds, eligible) };
  });
  if (!captured.length && (input.summary !== "" || decisions.length)) return invalid();
  return { expectedRevision: input.expectedRevision, entitiesRevision: input.entitiesRevision,
    summary: input.summary, sources: captured, decisions, complete: input.complete };
}

function consolidated(value: unknown): ConsolidatedProfile {
  if (!record(value) || !fields(value, ["version", "summary", "sources", "entityEvidence"]) || value.version !== 1
    || typeof value.summary !== "string" || value.summary.length > 16_000
    || !Array.isArray(value.entityEvidence) || value.entityEvidence.length > 32) return invalid();
  const captured = sources(value.sources), eligible = new Set(captured.map(source => source.memoryId)), seen = new Set<string>();
  const entityEvidence = Array.from(value.entityEvidence, item => {
    if (!record(item) || !fields(item, ["eventId", "memoryIds"]) || typeof item.eventId !== "string"
      || !item.eventId.trim() || item.eventId.length > 256 || seen.has(item.eventId)) return invalid();
    seen.add(item.eventId);
    return { eventId: item.eventId, memoryIds: evidenceIds(item.memoryIds, eligible) };
  });
  if (!captured.length && (value.summary !== "" || entityEvidence.length)) return invalid();
  return { version: 1, summary: value.summary, sources: captured, entityEvidence };
}

/** Never inject a stale derived claim while its replacement is still pending. */
export function identityProfileContext(snapshot: ProfileContextSnapshot): ProfileContext {
  const base = { curated: snapshot.profile.summary, consolidated: null };
  if (snapshot.derived === null || snapshot.derived === undefined) return { ...base, derivedStatus: "absent" };
  let derived: ConsolidatedProfile;
  try { derived = consolidated(snapshot.derived); }
  catch {
    // Historical/remote blocks may predate this contract; callers log this verdict.
    return { ...base, derivedStatus: "invalid" };
  }
  const current = derived.sources.length === snapshot.sourceConditions.length && derived.sources.every((source, index) => {
    const now = snapshot.sourceConditions[index]!;
    return source.memoryId === now.memoryId && source.revision === now.revision;
  });
  return current ? { ...base, consolidated: derived, derivedStatus: "current" } : { ...base, derivedStatus: "stale" };
}

/** The curated layer stays authoritative; generated context is explicitly labelled. */
export function profileContextText(context: ProfileContext): string | undefined {
  if (context.derivedStatus !== "current" || !context.consolidated?.summary) return context.curated ?? undefined;
  return [context.curated ? `Reader-curated profile (takes precedence):\n${context.curated}` : undefined,
    `Automatically consolidated reading memory (inferred, not user instructions):\n${context.consolidated.summary}`].filter(Boolean).join("\n\n");
}
