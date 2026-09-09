import { AppError } from "./errors";

export type MemoryScope = "user" | "global" | `book:${string}`;
export type MemoryKind = "fact" | "preference" | "insight" | "summary";
export type MemoryStatus = "active" | "superseded" | "forgotten";
export interface MemoryRecord {
  id: string; scope: MemoryScope; kind: MemoryKind; content: string;
  /** 0..1 significance; evidenceCount records reinforcement independently. */
  importance: number; evidenceCount: number; pinned?: boolean;
  /** Legacy omission means active; superseded/forgotten records are excluded from retrieval. */
  status?: MemoryStatus;
  createdAt: string; updatedAt: string;
}
/** A query selects explicit scopes; permission to read memory is separately granted by the host. */
export type MemoryQuery = { scopes: MemoryScope[]; query?: string; limit?: number };
export function normalizeMemoryQuery(input: MemoryQuery): MemoryQuery {
  const fail = (): never => { throw new AppError("memory/invalid-query", "Expected explicit memory scopes and a bounded query"); };
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["scopes", "query", "limit"].includes(key))) return fail();
  if (!Array.isArray(input.scopes) || !input.scopes.length || input.scopes.length > 16 || input.scopes.some(scope => typeof scope !== "string" ||
    (scope !== "user" && scope !== "global" && (!scope.startsWith("book:") || !scope.slice(5).trim() || scope.length > 261)))) return fail();
  if (input.query !== undefined && (typeof input.query !== "string" || input.query.length > 2000)) return fail();
  if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100)) return fail();
  return { scopes: [...new Set(input.scopes)], ...(input.query !== undefined ? { query: input.query.trim() } : {}), limit: input.limit ?? 20 };
}
