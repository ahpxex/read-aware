import { AppError } from "./errors";
import { normalizeMemoryQuery, type MemoryQuery, type MemoryRecord } from "./memory-query";

export type MemoryPageQuery = MemoryQuery & { offset?: number; expectedRevision?: string };
export type MemoryPage = {
  items: MemoryRecord[];
  offset: number;
  nextOffset: number | null;
  total: number;
  /** Identity of the filtered, ordered result, not a memory mutation token. */
  revision: string;
};

export function normalizeMemoryPageQuery(input: MemoryPageQuery): MemoryPageQuery & { offset: number; limit: number } {
  const fail = (): never => { throw new AppError("memory/invalid-query", "Invalid memory page query"); };
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => !["scopes", "query", "limit", "offset", "expectedRevision"].includes(key))) return fail();
  const { offset = 0, expectedRevision, ...filter } = input;
  const query = normalizeMemoryQuery(filter);
  if (!Number.isSafeInteger(offset) || offset < 0
    || expectedRevision !== undefined && (typeof expectedRevision !== "string" || !/^mpg1:[a-f0-9]{64}$/.test(expectedRevision))
    || offset > 0 && expectedRevision === undefined) return fail();
  return { ...query, offset, limit: query.limit!, ...(expectedRevision === undefined ? {} : { expectedRevision }) };
}
