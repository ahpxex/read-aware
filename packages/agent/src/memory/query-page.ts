import { AppError, normalizeMemoryPageQuery, normalizeMemoryQuery, type MemoryPage, type MemoryPageQuery, type MemoryQuery, type MemoryRecord } from "@read-aware/core";
import { matchesMemoryQuery } from "./query-match";

/** Search and pagination share matching and ordering, including a stable tie-break. */
export function selectMemoryRows(rows: MemoryRecord[], input: MemoryQuery): MemoryRecord[] {
  const query = normalizeMemoryQuery(input), scopes = new Set<string>(query.scopes);
  return rows.filter(memory => (memory.status ?? "active") === "active" && scopes.has(memory.scope)
    && (!query.query || matchesMemoryQuery(memory.content, query.query)))
    .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.importance - a.importance
      || b.updatedAt.localeCompare(a.updatedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Re-read each page; changes invalidate continuation instead of shifting rows. */
export async function pageMemoryRows(rows: MemoryRecord[], input: MemoryPageQuery): Promise<MemoryPage> {
  const query = normalizeMemoryPageQuery(input);
  const selected = selectMemoryRows(rows, { scopes: query.scopes, query: query.query, limit: query.limit });
  const items = selected.map(row => ({ id: row.id, scope: row.scope, kind: row.kind, content: row.content,
    importance: row.importance, evidenceCount: row.evidenceCount, pinned: row.pinned ?? false,
    status: row.status ?? "active", createdAt: row.createdAt, updatedAt: row.updatedAt } satisfies MemoryRecord));
  const bytes = new TextEncoder().encode(JSON.stringify({ scopes: [...query.scopes].sort(), query: query.query ?? "", items }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const revision = `mpg1:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
  if (query.expectedRevision !== undefined && query.expectedRevision !== revision) throw new AppError("memory/conflict", "Memory results changed; restart pagination");
  if (query.offset > items.length) throw new AppError("memory/invalid-query", "Memory offset is outside the result set");
  const end = Math.min(items.length, query.offset + query.limit);
  return { items: items.slice(query.offset, end), offset: query.offset, nextOffset: end < items.length ? end : null, total: items.length, revision };
}
