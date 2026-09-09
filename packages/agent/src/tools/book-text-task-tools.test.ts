import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildBookTextTaskTools } from "./book-text-task-tools";
import type { ThreadScope } from "../thread-scope";

test("both Agent scopes prepare, inspect and cancel the exact task/book without claiming synchronous work", async () => {
  for (const scope of [{ kind: "book", bookId: "book" }, { kind: "global", threadId: "global" }] satisfies ThreadScope[]) {
    const { deps } = createInMemoryDeps({ chapters: { book: [{ text: "Fixture text" }] } });
    const tools = buildBookTextTaskTools(scope, deps);
    const call = async (name: string, input: Record<string, unknown>) => {
      const result = await tools.find(t => t.name === name)!.execute("test", input);
      const content = result.content[0]; if (content?.type !== "text") throw Error("Expected text"); return JSON.parse(content.text);
    };
    const bookId = scope.kind === "book" ? "current" : "book";
    const task = await call("prepare_book_text", { bookId, rebuild: true });
    expect(task.bookId).toBe("book"); expect(task.mode).toBe("rebuild");
    expect(await call("get_book_text_tasks", { bookId, taskId: task.taskId })).toEqual(task);
    expect(await call("get_book_text_tasks", { bookId })).toEqual({ tasks: [task], total: 1, offset: 0, nextOffset: null });
    expect(await call("cancel_book_text_task", { bookId, taskId: task.taskId })).toEqual(task);
    await expect(call("cancel_book_text_task", { bookId: "other", taskId: task.taskId })).rejects.toMatchObject({ code: "library/text-task-not-found" });
    if (scope.kind === "global") await expect(call("prepare_book_text", {})).rejects.toThrow("bookId is required");
  }
});

test("task lists are bounded, newest first and page through retained history", async () => {
  const { deps } = createInMemoryDeps({ chapters: { book: [{ text: "Fixture" }] } });
  const created = [];
  for (let i = 0; i < 64; i++) created.push(await deps.bookText.preparation!.start("book"));
  const tool = buildBookTextTaskTools({ kind: "book", bookId: "book" }, deps).find(t => t.name === "get_book_text_tasks")!;
  const ids: string[] = [];
  for (let offset = 0; offset < 64; offset += 20) {
    const result = await tool.execute("test", { offset, limit: 20 });
    const content = result.content[0]; if (content?.type !== "text") throw Error("Expected text");
    expect(content.text.length).toBeLessThanOrEqual(16_000);
    const page = JSON.parse(content.text);
    expect(page.tasks.length).toBeLessThanOrEqual(20);
    expect(page.nextOffset).toBe(offset + 20 < 64 ? offset + 20 : null);
    ids.push(...page.tasks.map((task: { taskId: string }) => task.taskId));
  }
  expect(ids).toEqual(created.reverse().map(task => task.taskId));
  for (const input of [{ limit: 21 }, { limit: 0 }, { offset: -1 }, { offset: 1.5 }]) {
    await expect(tool.execute("test", input)).rejects.toMatchObject({ code: "library/invalid-input" });
  }
});

test("alternate hosts lacking task preparation do not advertise a fake tool", () => {
  const { deps } = createInMemoryDeps(); delete deps.bookText.preparation;
  expect(buildBookTextTaskTools({ kind: "book", bookId: "book" }, deps)).toEqual([]);
});
