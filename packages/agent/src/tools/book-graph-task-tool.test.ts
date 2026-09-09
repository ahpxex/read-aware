import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildBookGraphTaskTool } from "./book-graph-task-tool";
import type { ThreadScope } from "../thread-scope";

test("both scopes require renewed approval for model work and freeze the approved request", async () => {
  for (const scope of [{ kind: "book", bookId: "b" }, { kind: "global", threadId: "g" }] as ThreadScope[]) {
    const f = createInMemoryDeps({ books: [{ id: "b", title: "Book" }] }), tool = buildBookGraphTaskTool(scope, f.deps);
    const request = { action: "start", bookId: "b" };
    f.deps.interactions.request = async () => { request.action = "rebuild"; request.bookId = "other"; return { optionId: "approve" }; };
    await tool.execute("start", request);
    const tasks = await f.deps.bookGraphTasks.list("b"); expect(tasks).toHaveLength(1); expect(tasks[0]!.mode).toBe("catch-up");
    f.deps.interactions.request = async () => ({ optionId: "decline" });
    await tool.execute("declined", { action: "rebuild", bookId: "b" }); expect(await f.deps.bookGraphTasks.list("b")).toHaveLength(1);
  }
});
test("invalid scope, malformed actions, pagination and cancelled approvals never start tasks", async () => {
  const f = createInMemoryDeps({ books: [{ id: "b", title: "Book" }] }), tool = buildBookGraphTaskTool({ kind: "book", bookId: "b" }, f.deps);
  await expect(tool.execute("bad", { action: "start", bookId: "other" })).rejects.toMatchObject({ code: "memory/forbidden" });
  await expect(tool.execute("bad", { action: "start", taskId: "unexpected" })).rejects.toMatchObject({ code: "memory/invalid-input" });
  await expect(tool.execute("bad", { action: "get" })).rejects.toMatchObject({ code: "memory/invalid-input" });
  await expect(tool.execute("bad", { action: "list", limit: 21 })).rejects.toMatchObject({ code: "memory/invalid-input" });
  const controller = new AbortController();
  f.deps.interactions.request = async () => { controller.abort(); return { optionId: "approve" }; };
  await expect(tool.execute("cancel", { action: "start" }, controller.signal)).rejects.toBeDefined();
  expect(await f.deps.bookGraphTasks.list("b")).toHaveLength(0);
});
