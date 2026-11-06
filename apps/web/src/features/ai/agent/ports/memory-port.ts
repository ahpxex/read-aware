/**
 * MemoryPort over the SQLite memory store。语义与 testing fixtures 对齐
 * （初始低置信、强化 +证据+置信、检索按 pinned/importance/recency 排序）。
 * 每个意图点双写记忆域事件（事件先行、投影随后，origin "agent"）——
 * memories 投影因此可从日志重放，写决策本身成为可同步事实
 * （docs/architecture/data-model.md：consolidation as events）。
 */
import { type MemoryPort, type MemoryRecord } from "@read-aware/agent";
import { normalizeMemoryPageQuery, normalizeMemoryQuery } from "@read-aware/core";
import { broadcastDomainEventDrafts, dispatchMinted, type DomainEventDraft } from "../../../../platform/domain-events";
import { runDomainWrite } from "../../../../platform/domain-write-gate";
import { invoke } from "../../../../platform/ipc";
import { pageMemoryRows } from "./memory-store";
import { applyMemoryChanges, reinforceMemory, snapshotMemories } from "./memory-maintenance";

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
      return (await pageMemoryRows(query)).items;
    },
    pageMemories: async (input) => {
      const query = normalizeMemoryPageQuery(input);
      return pageMemoryRows(query);
    },
    listMemories: async () => (await snapshotMemories()).map((snapshot) => snapshot.memory),
    saveMemory: async (input) => {
      const now = new Date().toISOString();
      const record: MemoryRecord = {
        id: crypto.randomUUID(),
        scope: input.scope,
        kind: input.kind,
        content: input.content,
        importance: input.origin === "extraction" || input.origin === "plugin" ? 0.35 : 0.5,
        evidenceCount: 1,
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      const draft: DomainEventDraft = {
        type: "memory.promoted",
        payload: {
          memoryId: record.id,
          kind: record.kind,
          ...eventScope(record.scope),
          content: record.content,
          importance: record.importance,
        },
        origin: "agent",
      };
      return runDomainWrite(async () => {
        const result = await dispatchMinted([draft], ([event]) =>
          invoke<{ memory: MemoryRecord; inserted: boolean }>("memory_create", {
            event,
            automatic: input.origin === "extraction" || input.origin === "plugin",
          }),
        );
        if (result.inserted) broadcastDomainEventDrafts([draft]);
        return result.memory;
      });
    },
    snapshotMemories: async (filter) => snapshotMemories(filter ? normalizeMemoryQuery(filter) : undefined),
    reinforceMemory,
    applyMemoryChanges,
  };
}
