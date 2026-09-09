/**
 * MemoryPort over the SQLite memory store。语义与 testing fixtures 对齐
 * （初始低置信、强化 +证据+置信、检索按 pinned/importance/recency 排序）。
 * 每个意图点双写记忆域事件（事件先行、投影随后，origin "agent"）——
 * memories 投影因此可从日志重放，写决策本身成为可同步事实
 * （docs/data-model.md：consolidation as events）。
 */
import { matchesMemoryQuery, type MemoryPort, type MemoryRecord } from "@read-aware/agent";
import { normalizeMemoryQuery } from "@read-aware/core";
import { commitDomainEvents } from "../../../../platform/domain-events";
import { listAllMemoryRows } from "./memory-store";
import { applyMemoryChanges, reinforceMemory, snapshotMemories } from "./memory-maintenance";

const isActive = (memory: MemoryRecord) => (memory.status ?? "active") === "active";

/** agent 的 scope（"user" | "global" | `book:<id>`）→ 事件目录的 scope 字段。 */
function eventScope(scope: MemoryRecord["scope"]): {
  scope: "user" | "global" | "book";
  bookId?: string;
} {
  if (scope.startsWith("book:")) return { scope: "book", bookId: scope.slice("book:".length) };
  return { scope: scope === "global" ? "global" : "user" };
}

export function createMemoryPort(): MemoryPort {
  return {
    searchMemories: async (filter) => {
      const query = normalizeMemoryQuery(filter);
      const scopes = new Set<string>(query.scopes);
      return (await listAllMemoryRows())
        .filter(
          (memory) =>
            isActive(memory) &&
            scopes.has(memory.scope) &&
            (!query.query || matchesMemoryQuery(memory.content, query.query)),
        )
        .sort(
          (a, b) =>
            Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
            b.importance - a.importance ||
            b.updatedAt.localeCompare(a.updatedAt),
        )
        .slice(0, query.limit);
    },
    listMemories: async () => (await listAllMemoryRows()).filter(isActive),
    saveMemory: async (input) => {
      const now = new Date().toISOString();
      const record: MemoryRecord = {
        id: crypto.randomUUID(),
        scope: input.scope,
        kind: input.kind,
        content: input.content,
        importance:
          input.origin === "extraction" || input.origin === "plugin" ? 0.35 : 0.5,
        evidenceCount: 1,
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      await commitDomainEvents({
        type: "memory.promoted",
        payload: {
          memoryId: record.id,
          kind: record.kind,
          ...eventScope(record.scope),
          content: record.content,
          importance: record.importance,
        },
        origin: "agent",
      });
      return record;
    },
    snapshotMemories: async (filter) => {
      const snapshots = await snapshotMemories();
      if (!filter) return snapshots;
      const query = normalizeMemoryQuery(filter);
      const scopes = new Set<string>(query.scopes);
      return snapshots.filter(({ memory }) => scopes.has(memory.scope) && (!query.query || matchesMemoryQuery(memory.content, query.query)))
        .sort((a, b) => Number(b.memory.pinned ?? false) - Number(a.memory.pinned ?? false) || b.memory.importance - a.memory.importance || b.memory.updatedAt.localeCompare(a.memory.updatedAt))
        .slice(0, query.limit);
    },
    reinforceMemory,
    applyMemoryChanges,
  };
}
