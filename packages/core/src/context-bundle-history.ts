import { AppError } from "./errors";
import { contextBundleSelector, type ContextBundleSelector } from "./context-bundle";

export type ContextBundleHistoryQuery = ContextBundleSelector & { offset?: number; limit?: number; expectedRevision?: string };
export type ContextBundleReadQuery = ContextBundleSelector & { version: string };
export type ContextBundleHistoryEntry = { version: string; publishedAt: string };
export type ContextBundleHistoryPage = {
  selector: ContextBundleSelector; items: ContextBundleHistoryEntry[];
  offset: number; nextOffset: number | null; total: number; revision: string;
};
const invalid = (): never => { throw new AppError("memory/invalid-query", "Invalid context bundle query"); };
function object(input: unknown, allowed: string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) return invalid();
  return input as Record<string, unknown>;
}
export function normalizeContextBundleSelector(input: unknown): ContextBundleSelector {
  const row = object(input, ["kind", "scope"]);
  try { return contextBundleSelector(row); }
  catch { return invalid(); }
}
export function normalizeContextBundleHistoryQuery(input: unknown): Required<Omit<ContextBundleHistoryQuery, "expectedRevision">> & { expectedRevision?: string } {
  const row = object(input, ["kind", "scope", "offset", "limit", "expectedRevision"]);
  const selector = normalizeContextBundleSelector({ kind: row.kind, scope: row.scope });
  const offset = row.offset ?? 0, limit = row.limit ?? 20;
  if (!Number.isSafeInteger(offset) || (offset as number) < 0 || !Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 100
    || row.expectedRevision !== undefined && (typeof row.expectedRevision !== "string" || !/^cbhist1:[a-f0-9]{64}$/.test(row.expectedRevision))
    || (offset as number) > 0 && row.expectedRevision === undefined || row.offset === null || row.limit === null) return invalid();
  return { ...selector, offset: offset as number, limit: limit as number,
    ...(row.expectedRevision === undefined ? {} : { expectedRevision: row.expectedRevision as string }) };
}
export function normalizeContextBundleReadQuery(input: unknown): ContextBundleReadQuery {
  const row = object(input, ["kind", "scope", "version"]);
  if (typeof row.version !== "string" || !/^cb1:[a-f0-9]{64}$/.test(row.version)) return invalid();
  return { ...normalizeContextBundleSelector({ kind: row.kind, scope: row.scope }), version: row.version };
}

/** Native responses are checked independently from the caller's requested page. */
export function normalizeContextBundleHistoryPage(input: unknown, query: ContextBundleHistoryQuery): ContextBundleHistoryPage {
  const expected = normalizeContextBundleHistoryQuery(query);
  const row = object(input, ["selector", "items", "offset", "nextOffset", "total", "revision"]);
  const selector = normalizeContextBundleSelector(row.selector);
  if (JSON.stringify(selector) !== JSON.stringify({ kind: expected.kind, scope: expected.scope })
    || row.offset !== expected.offset || !Number.isSafeInteger(row.total) || (row.total as number) < expected.offset
    || typeof row.revision !== "string" || !/^cbhist1:[a-f0-9]{64}$/.test(row.revision)
    || expected.expectedRevision !== undefined && row.revision !== expected.expectedRevision
    || !Array.isArray(row.items) || row.items.length !== Math.min(expected.limit, (row.total as number) - expected.offset)) return invalid();
  const items = row.items.map(input => {
    const item = object(input, ["version", "publishedAt"]);
    const { version } = normalizeContextBundleReadQuery({ ...selector, version: item.version });
    if (typeof item.publishedAt !== "string" || !item.publishedAt || item.publishedAt.length > 64 || /[\u0000\uD800-\uDFFF]/u.test(item.publishedAt)) return invalid();
    return { version, publishedAt: item.publishedAt };
  });
  if (new Set(items.map(item => item.version)).size !== items.length || items.some((item, i) => {
    const prior = items[i - 1];
    return prior && (prior.publishedAt < item.publishedAt || prior.publishedAt === item.publishedAt && prior.version <= item.version);
  })) return invalid();
  const nextOffset = expected.offset + items.length < (row.total as number) ? expected.offset + items.length : null;
  if (row.nextOffset !== nextOffset) return invalid();
  return { selector, items, offset: expected.offset, nextOffset, total: row.total as number, revision: row.revision };
}
