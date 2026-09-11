import { AppError } from "./errors";
import { identityProfileContext, parseConsolidatedProfile, type IdentitySource, type ProfileContext, type ProfileContextSnapshot } from "./identity-consolidation";
import { userProfilePage } from "./user-profile";

export type ProfileInspectionQuery = {
  kind?: "summary" | "sources" | "entityEvidence";
  offset?: number;
  limit?: number;
  expectedRevision?: string;
};
type InspectionBase = {
  revision: string;
  curatedRevision: string;
  curatedExists: boolean;
  /** Current means source-consistent, not semantically verified or a completed maintenance pass. */
  derivedStatus: ProfileContext["derivedStatus"];
  offset: number;
  nextOffset: number | null;
};
export type ProfileInspectionPage = InspectionBase & (
  | { kind: "summary"; text: string | null; totalLength: number }
  | { kind: "sources"; items: (IdentitySource & { currentRevision: string | null })[]; total: number }
  /** Proposed event IDs can name no-ops. These links are not emission receipts. */
  | { kind: "entityEvidence"; items: { eventId: string; memoryId: string }[]; total: number }
);

export function normalizeProfileInspectionQuery(input: ProfileInspectionQuery = {}) {
  const fail = (): never => { throw new AppError("memory/invalid-query", "Invalid profile inspection query"); };
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => !["kind", "offset", "limit", "expectedRevision"].includes(key))) return fail();
  const kind = input.kind ?? "summary";
  if (!["summary", "sources", "entityEvidence"].includes(kind) || input.kind === null) return fail();
  const offset = input.offset === undefined ? 0 : input.offset;
  const limit = input.limit === undefined ? kind === "summary" ? 4000 : 25 : input.limit;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit)
    || limit < (kind === "summary" ? 2 : 1) || limit > (kind === "summary" ? 16000 : 100)
    || input.expectedRevision !== undefined && (typeof input.expectedRevision !== "string" || !/^pctx1:[a-f0-9]{64}$/.test(input.expectedRevision))
    || offset > 0 && input.expectedRevision === undefined) return fail();
  return { kind, offset, limit, ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }) };
}

/** Inspect stale provenance without making it eligible for prompt injection. No raw invalid block is exposed. */
export async function profileInspectionPage(raw: ProfileContextSnapshot, input: ProfileInspectionQuery = {}): Promise<ProfileInspectionPage> {
  const query = normalizeProfileInspectionQuery(input), snapshot = structuredClone(raw);
  const context = identityProfileContext(snapshot);
  const derived = context.derivedStatus === "stale" ? parseConsolidatedProfile(snapshot.derived) : context.consolidated;
  // Pin every page kind to the same captured native transaction, including source-only changes.
  const bytes = new TextEncoder().encode(JSON.stringify([snapshot.profile.revision, snapshot.derived, snapshot.sourceConditions]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const revision = `pctx1:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
  if (query.expectedRevision !== undefined && query.expectedRevision !== revision) throw new AppError("memory/conflict", "Profile inspection changed; restart pagination");
  const base = { revision, curatedRevision: snapshot.profile.revision, curatedExists: snapshot.profile.summary !== null,
    derivedStatus: context.derivedStatus, offset: query.offset };
  if (query.kind === "summary") {
    const page = await userProfilePage({ summary: derived?.summary ?? null, revision: snapshot.profile.revision }, {
      offset: query.offset, limit: query.limit, ...(query.offset ? { expectedRevision: snapshot.profile.revision } : {}),
    });
    return { ...base, kind: query.kind, text: derived ? page.text : null, totalLength: page.totalLength, nextOffset: page.nextOffset };
  }
  const total = query.kind === "sources" ? derived?.sources.length ?? 0
    : derived?.entityEvidence.reduce((count, item) => count + item.memoryIds.length, 0) ?? 0;
  if (query.offset > total) throw new AppError("memory/invalid-query", "Invalid profile inspection offset");
  const end = Math.min(total, query.offset + query.limit), nextOffset = end < total ? end : null;
  if (query.kind === "sources") {
    const current = new Map(snapshot.sourceConditions.map(source => [source.memoryId, source.revision]));
    return { ...base, kind: query.kind, total, nextOffset,
      items: (derived?.sources.slice(query.offset, end) ?? []).map(source => ({ ...source, currentRevision: current.get(source.memoryId) ?? null })) };
  }
  const items: { eventId: string; memoryId: string }[] = [];
  let offset = 0;
  for (const entry of derived?.entityEvidence ?? []) {
    const start = Math.max(0, query.offset - offset), stop = Math.min(entry.memoryIds.length, end - offset);
    for (let index = start; index < stop; ++index) items.push({ eventId: entry.eventId, memoryId: entry.memoryIds[index]! });
    offset += entry.memoryIds.length;
    if (offset >= end) break;
  }
  return { ...base, kind: query.kind, total, nextOffset, items };
}
