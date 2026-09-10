import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildConversationTools } from "./conversation-tools";

test("summary tool reads book/global/current targets without generating or exposing runtime state", async () => {
  const { deps } = createInMemoryDeps({ insights: { "book:b1": "book summary", "global:thread-one": "global summary" } });
  const tool = buildConversationTools({ kind: "global", threadId: "thread-one" }, deps).find(tool => tool.name === "get_conversation_insights")!;
  expect(JSON.stringify(await tool.execute("one", { bookId: "b1" }))).toContain("book summary");
  expect(JSON.stringify(await tool.execute("two", {}))).toContain("global summary");
  const missing = await tool.execute("three", { threadId: "thread-missing" });
  expect(missing.content[0]).toEqual({ type: "text", text: JSON.stringify({ threadId: "thread-missing", summary: null }) });
  await expect(tool.execute("bad", { bookId: "b1", threadId: "thread-one" })).rejects.toMatchObject({ code: "ui/invalid-target" });
  await expect(tool.execute("bad-kind", { threadId: "b1" })).rejects.toMatchObject({ code: "ui/invalid-target" });
  expect(buildConversationTools({ kind: "book", bookId: "b1" }, deps).some(candidate => candidate.name === "get_conversation_insights")).toBe(false);
  const abort = new AbortController(); abort.abort();
  await expect(tool.execute("cancel", {}, abort.signal)).rejects.toThrow();
  const late = new AbortController();
  deps.conversations.getInsights = async () => { late.abort(); return "do not deliver"; };
  await expect(tool.execute("late", {}, late.signal)).rejects.toThrow();
});
