import { expect, spyOn, test } from "bun:test";
import { localKV } from "../platform/local-store";
import { createConversationPort } from "../features/ai/agent/ports/conversation-port";
import { buildPluginContext } from "../features/plugins/runtime/plugin-context";
import { getStoredConversationInsights } from "../features/ai/lib/conversation-insights-store";

test("Agent and authorized plugin summaries share storage, legacy fallback and committed invalidation", async () => {
  let value = JSON.stringify({ "book:b1": "book summary", global: "legacy global", "global:thread-one": "another thread" });
  const read = spyOn(localKV, "getItem").mockImplementation(key => key === "read-aware-agent-insights" ? value : null);
  const write = spyOn(localKV, "setItemAsync").mockImplementation(async (key, next) => { expect(key).toBe("read-aware-agent-insights"); value = next; });
  const manifest = { id: "insights", name: "Insights", version: "1", schemaVersion: 1, requires: {} };
  const actor = buildPluginContext({ ...manifest, permissions: ["conversations:read"] }, "1", []);
  const denied = buildPluginContext(manifest, "1", []);
  const agent = createConversationPort(); actor.lifecycle.promote();
  const events: unknown[] = [];
  try {
    expect(denied.context.domains.conversations).toBeUndefined();
    const domain = actor.context.domains.conversations!;
    expect(domain.commands).toBeUndefined();
    expect(Object.keys(domain.queries)).not.toContain("putInsights");
    domain.events.observeInvalidation(event => { events.push(event); });
    expect(await domain.queries.getInsights({ kind: "book", id: "b1" })).toBe(await agent.getInsights("book:b1") ?? null);
    expect(await domain.queries.getInsights({ kind: "global", id: "__global__" })).toBe("legacy global");
    expect(await domain.queries.getInsights({ kind: "global", id: "thread-one" })).toBe("another thread");
    expect(await domain.queries.getInsights({ kind: "global", id: "thread-missing" })).toBeNull();
    await expect(domain.queries.getInsights({ kind: "global", id: "b1" })).rejects.toMatchObject({ code: "ui/invalid-target" });
    expect(getStoredConversationInsights("toString")).toBeUndefined();
    await agent.putInsights("book:b1", "new summary"); await Bun.sleep(0);
    expect(events).toHaveLength(2);
    expect(await domain.queries.getInsights({ kind: "book", id: "b1" })).toBe("new summary");
    await agent.clearInsights!("book:b1"); await Bun.sleep(0);
    expect(events).toHaveLength(3);
    expect(await domain.queries.getInsights({ kind: "book", id: "b1" })).toBeNull();
    write.mockRejectedValue(new Error("failed write"));
    await expect(agent.putInsights("book:b1", "not saved")).rejects.toThrow("failed write"); await Bun.sleep(0);
    expect(events).toHaveLength(3);
    actor.lifecycle.stop();
    expect(() => domain.queries.getInsights({ kind: "book", id: "b1" })).toThrow();
  } finally { actor.lifecycle.stop(); denied.lifecycle.stop(); read.mockRestore(); write.mockRestore(); }
});

test("corrupt summary storage is an error, not absence or an invitation to overwrite", async () => {
  const read = spyOn(localKV, "getItem");
  const write = spyOn(localKV, "setItemAsync");
  const agent = createConversationPort();
  try {
    for (const value of ["{", "null", "[]", '{"book:b1":5}']) {
      read.mockReturnValue(value);
      await expect(agent.getInsights("book:b1")).rejects.toMatchObject({ code: "db/error" });
      await expect(agent.putInsights("book:b1", "replacement")).rejects.toMatchObject({ code: "db/error" });
    }
    expect(write).not.toHaveBeenCalled();
    read.mockReturnValue(null);
    expect(await agent.getInsights("book:b1")).toBeUndefined();
  } finally { read.mockRestore(); write.mockRestore(); }
});
