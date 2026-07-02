/**
 * MemoryPort over the IndexedDB memory store。语义与 testing fixtures 对齐
 * （初始低置信、强化 +证据+置信、检索按 pinned/importance/recency 排序），
 * 将来换 SQLite 投影时只动这一层。
 */
import type { MemoryPort, MemoryRecord } from "@read-aware/agent";
import { getMemoryRow, listAllMemoryRows, putMemoryRow } from "./memory-store";

const isActive = (memory: MemoryRecord) => (memory.status ?? "active") === "active";

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
      await putMemoryRow(record);
      return record;
    },
    reinforceMemory: async (id) => {
      const memory = await getMemoryRow(id);
      if (!memory) return;
      memory.evidenceCount += 1;
      memory.importance = Math.min(1, memory.importance + 0.15);
      memory.updatedAt = new Date().toISOString();
      await putMemoryRow(memory);
    },
    applyMemoryChanges: async (changes) => {
      const now = new Date().toISOString();
      for (const change of changes) {
        const memory = await getMemoryRow(change.id);
        if (!memory) continue;
        switch (change.type) {
          case "supersede": {
            memory.status = "superseded";
            await putMemoryRow(memory);
            if (change.byId) {
              const winner = await getMemoryRow(change.byId);
              if (winner) {
                winner.evidenceCount += 1;
                winner.importance = Math.min(1, winner.importance + 0.1);
                winner.updatedAt = now;
                await putMemoryRow(winner);
              }
            }
            break;
          }
          case "forget":
            memory.status = "forgotten";
            await putMemoryRow(memory);
            break;
          case "promote":
            memory.scope = change.scope;
            memory.updatedAt = now;
            await putMemoryRow(memory);
            break;
          case "decay":
            memory.importance = change.importance;
            await putMemoryRow(memory);
            break;
        }
      }
    },
  };
}
