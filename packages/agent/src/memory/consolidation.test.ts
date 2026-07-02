import { describe, expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import type { Api, Model } from "@earendil-works/pi-ai";
import { createInMemoryDeps, seedMemory } from "../testing/fixtures";
import { decayChanges, runConsolidation } from "./consolidation";

const MODEL = { id: "fake", provider: "fake", api: "fake" } as unknown as Model<Api>;
const NOW = Date.parse("2026-07-02T00:00:00Z");
const OLD = "2026-05-01T00:00:00Z"; // 62 天前
const FRESH = "2026-06-30T00:00:00Z";

describe("decayChanges", () => {
  test("decays stale memories, forgets weak ones, spares pinned and fresh", () => {
    const memories = [
      seedMemory({ id: "stale", scope: "user", content: "旧而有据", importance: 0.6, updatedAt: OLD }),
      seedMemory({ id: "weak", scope: "user", content: "旧且弱", importance: 0.16, evidenceCount: 1, updatedAt: OLD }),
      seedMemory({ id: "pinned", scope: "user", content: "置顶", importance: 0.2, pinned: true, updatedAt: OLD }),
      seedMemory({ id: "fresh", scope: "user", content: "新写入", importance: 0.2, updatedAt: FRESH }),
    ];
    const changes = decayChanges(memories, NOW);
    expect(changes).toContainEqual({ type: "decay", id: "stale", importance: 0.51 });
    expect(changes).toContainEqual({ type: "forget", id: "weak" });
    expect(changes.find((c) => c.id === "pinned")).toBeUndefined();
    expect(changes.find((c) => c.id === "fresh")).toBeUndefined();
  });
});

describe("runConsolidation", () => {
  test("applies merges, contradictions, and gated promotions", async () => {
    const { deps, stores } = createInMemoryDeps({
      memories: [
        seedMemory({ id: "m1", scope: "user", content: "偏好深挖", evidenceCount: 2, updatedAt: FRESH }),
        seedMemory({ id: "m2", scope: "user", content: "喜欢刨根问底", evidenceCount: 1, updatedAt: FRESH }),
        seedMemory({ id: "m3", scope: "book:b1", content: "总是追问概念的历史来源", evidenceCount: 4, updatedAt: FRESH }),
        seedMemory({ id: "m4", scope: "book:b1", content: "证据不足的书内观察", evidenceCount: 1, updatedAt: FRESH }),
      ],
    });
    const report = await runConsolidation({
      memory: deps.memory,
      model: MODEL,
      now: NOW,
      complete: async () =>
        fauxAssistantMessage(
          JSON.stringify({
            merges: [{ keep: "m1", drop: "m2" }],
            contradictions: [],
            promotions: [
              { id: "m3", scope: "user" }, // 证据 4 ≥ 3，放行
              { id: "m4", scope: "user" }, // 证据 1，闸门拦截
              { id: "m1", scope: "global" }, // 非 book scope，拦截
              { id: "ghost", scope: "user" }, // 不存在的 id，拦截
            ],
          }),
        ),
    });

    expect(report).toEqual({ decayed: 0, forgotten: 0, merged: 1, promoted: 1 });
    expect(stores.memories.find((m) => m.id === "m2")?.status).toBe("superseded");
    const kept = stores.memories.find((m) => m.id === "m1");
    expect(kept?.evidenceCount).toBe(3); // 合并即强化
    expect(stores.memories.find((m) => m.id === "m3")?.scope).toBe("user");
    expect(stores.memories.find((m) => m.id === "m4")?.scope).toBe("book:b1");
  });

  test("LLM failure still applies deterministic decay", async () => {
    const { deps, stores } = createInMemoryDeps({
      memories: [seedMemory({ id: "stale", scope: "user", content: "旧而有据", importance: 0.6, updatedAt: OLD })],
    });
    const report = await runConsolidation({
      memory: deps.memory,
      model: MODEL,
      now: NOW,
      complete: async () => {
        throw new Error("network down");
      },
    });
    expect(report.decayed).toBe(1);
    expect(stores.memories[0].importance).toBe(0.51);
  });
});
