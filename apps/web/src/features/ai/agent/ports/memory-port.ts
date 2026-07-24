/**
 * MemoryPort over the SQLite memory store。语义与 testing fixtures 对齐
 * （初始低置信、强化 +证据+置信、检索按 pinned/importance/recency 排序）。
 * 每个意图点双写记忆域事件（事件先行、投影随后，origin "agent"）——
 * memories 投影因此可从日志重放，写决策本身成为可同步事实
 * （docs/data-model.md：consolidation as events）。
 */
import type { MemoryPort, MemoryRecord } from "@read-aware/agent";
import { commitDomainEvents } from "../../../../platform/domain-events";
import { getMemoryRow, listAllMemoryRows } from "./memory-store";

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
      const scopes = new Set<string>(filter.scopes);
      return (await listAllMemoryRows())
        .filter(
          (memory) =>
            isActive(memory) &&
            scopes.has(memory.scope) &&
            (!filter.query || memory.content.includes(filter.query)),
        )
        .sort(
          (a, b) =>
            Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
            b.importance - a.importance ||
            b.updatedAt.localeCompare(a.updatedAt),
        )
        .slice(0, filter.limit ?? 50);
    },
    listMemories: async () => (await listAllMemoryRows()).filter(isActive),
    saveMemory: async (input) => {
      const now = new Date().toISOString();
      const record: MemoryRecord = {
        id: crypto.randomUUID(),
        scope: input.scope,
        kind: input.kind,
        content: input.content,
        importance: input.origin === "extraction" ? 0.35 : 0.5,
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
    reinforceMemory: async (id) => {
      const memory = await getMemoryRow(id);
      if (!memory) return;
      memory.evidenceCount += 1;
      memory.importance = Math.min(1, memory.importance + 0.15);
      memory.updatedAt = new Date().toISOString();
      await commitDomainEvents({
        type: "memory.revised",
        payload: {
          memoryId: memory.id,
          importance: memory.importance,
          evidenceCount: memory.evidenceCount,
        },
        origin: "agent",
      });
    },
    applyMemoryChanges: async (changes) => {
      const now = new Date().toISOString();
      for (const change of changes) {
        const memory = await getMemoryRow(change.id);
        if (!memory) continue;
        switch (change.type) {
          case "supersede": {
            memory.status = "superseded";
            await commitDomainEvents({
              type: "memory.superseded",
              payload: { memoryId: memory.id, bySupersedingId: change.byId },
              origin: "agent",
            });
            if (change.byId) {
              const winner = await getMemoryRow(change.byId);
              if (winner) {
                winner.evidenceCount += 1;
                winner.importance = Math.min(1, winner.importance + 0.1);
                winner.updatedAt = now;
                await commitDomainEvents({
                  type: "memory.revised",
                  payload: {
                    memoryId: winner.id,
                    importance: winner.importance,
                    evidenceCount: winner.evidenceCount,
                  },
                  origin: "agent",
                });
              }
            }
            break;
          }
          case "forget":
            memory.status = "forgotten";
            await commitDomainEvents({
              type: "memory.forgotten",
              payload: { memoryId: memory.id, reason: "decay" },
              origin: "agent",
            });
            break;
          case "promote":
            memory.scope = change.scope;
            memory.updatedAt = now;
            await commitDomainEvents({
              type: "memory.revised",
              payload: { memoryId: memory.id, ...eventScope(memory.scope) },
              origin: "agent",
            });
            break;
          case "decay":
            memory.importance = change.importance;
            await commitDomainEvents({
              type: "memory.revised",
              payload: { memoryId: memory.id, importance: memory.importance },
              origin: "agent",
            });
            break;
        }
      }
    },
  };
}
