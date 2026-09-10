import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildConversationControlTools } from "./conversation-control-tools";

test("conversation mutation requires explicit approval for clear and refuses its executing thread", async () => {
  const { deps, stores } = createInMemoryDeps(), calls: unknown[] = [];
  deps.conversationControl.clear = async target => { calls.push(target); return { status: "completed", target }; };
  const tool = buildConversationControlTools({ kind: "global", threadId: "thread-current" }, deps).find(t => t.name === "manage_conversation")!;
  const target = { kind: "global", id: "thread-other" };
  await tool.execute("clear", { action: "clear", target });
  expect(stores.interactions[0]).toMatchObject({ kind: "permission", action: "clear-conversation", subject: "global:thread-other" });
  expect(calls).toEqual([target]);
  deps.interactions.request = async () => ({ optionId: "decline" });
  await tool.execute("decline", { action: "clear", target }); expect(calls).toHaveLength(1);
  for (const action of ["clear", "stop"]) await expect(tool.execute(action, { action, target: { kind: "global", id: "thread-current" } })).rejects.toMatchObject({ code: "ui/unavailable" });
  await expect(tool.execute("bad", { action: "select", target: { kind: "global", id: "book-id" } })).rejects.toMatchObject({ code: "ui/invalid-target" });
});
test("book scope exposes only its own live state and no self-mutating tool", async () => {
  const { deps } = createInMemoryDeps();
  deps.conversationControl.snapshot = async () => ({ revision: 3, selectedGlobalThreadId: "thread-private", sessions: [
    { kind: "global", id: "thread-private", sessionId: "g", loading: false, streaming: true, messageCount: 100 },
    { kind: "book", id: "book", sessionId: "b", loading: false, streaming: false, messageCount: 2 },
  ] });
  const tools = buildConversationControlTools({ kind: "book", bookId: "book" }, deps);
  expect(tools.map(tool => tool.name)).toEqual(["get_conversation_state"]);
  const result = JSON.stringify(await tools[0].execute("state", {}));
  expect(result).not.toContain("thread-private"); expect(result).toContain("book");
  const abort = new AbortController(); abort.abort(Error("cancelled"));
  await expect(tools[0].execute("cancel", {}, abort.signal)).rejects.toThrow("cancelled");
});
