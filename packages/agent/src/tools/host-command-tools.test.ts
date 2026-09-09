import { expect, test } from "bun:test";
import { AppError, HOST_COMMAND_IDS } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildAgentTools } from "./registry";

test("both Agent scopes discover and execute the same finite commands with guards and cancellation", async () => {
  for (const scope of [{ kind: "global", threadId: "global" }, { kind: "book", bookId: "book" }] as const) {
    const { deps } = createInMemoryDeps(), calls: unknown[] = [], abort = new AbortController();
    deps.hostCommands.list = async signal => { calls.push(signal); return { version: 1, workspaceRevision: 4, commands: [] }; };
    deps.hostCommands.execute = async (...args) => { calls.push(args); return { commandId: "layout-list", status: "partial", completed: ["settings"], errorCode: "ui/superseded" }; };
    const tools = buildAgentTools(scope, deps), list = tools.find(t => t.name === "list_host_commands")!, execute = tools.find(t => t.name === "execute_host_command")!;
    expect(JSON.stringify(await list.execute("test", {}, abort.signal))).toContain('workspaceRevision');
    expect(JSON.stringify(await execute.execute("test", { id: "layout-list", expectedWorkspaceRevision: 4 }, abort.signal))).toContain("partial");
    expect(calls).toEqual([abort.signal, [{ id: "layout-list", expectedWorkspaceRevision: 4 }, abort.signal]]);
    const schema = execute.parameters as { properties: { id: { anyOf: { const: string }[] } } };
    expect(schema.properties.id.anyOf.map(v => v.const)).toEqual([...HOST_COMMAND_IDS]);
    await expect(execute.execute("test", { id: "import" })).rejects.toMatchObject({ code: "ui/invalid-target" });
    const error = new AppError("plugin/cancelled", "cancelled"); abort.abort(error);
    await expect(execute.execute("test", { id: "go-stats" }, abort.signal)).rejects.toBe(error);
    await expect(list.execute("test", {}, abort.signal)).rejects.toBe(error); expect(calls).toHaveLength(2);
  }
});

test("cancellation after a committed setting does not erase the host's partial receipt", async () => {
  const { deps } = createInMemoryDeps(), abort = new AbortController();
  deps.hostCommands.execute = async request => {
    abort.abort(new AppError("plugin/cancelled", "retired after commit"));
    return { commandId: request.id, status: "partial", completed: ["settings"], errorCode: "plugin/cancelled" };
  };
  const tool = buildAgentTools({ kind: "global", threadId: "test" }, deps).find(t => t.name === "execute_host_command")!;
  expect(JSON.stringify(await tool.execute("test", { id: "layout-list" }, abort.signal))).toContain('partial');
});

test("typed resources are validated and forwarded without converting labels to IDs", async () => {
  const { deps } = createInMemoryDeps(), calls: unknown[] = [];
  deps.hostCommands.execute = async request => { calls.push(request); return { commandId: request.id, status: "completed", completed: ["reading"] }; };
  const tool = buildAgentTools({ kind: "book", bookId: "current" }, deps).find(t => t.name === "execute_host_command")!;
  await tool.execute("test", { id: "open-book", args: { bookId: "chosen" }, expectedWorkspaceRevision: 2 });
  expect(calls).toEqual([{ id: "open-book", args: { bookId: "chosen" }, expectedWorkspaceRevision: 2 }]);
  await expect(tool.execute("test", { id: "open-collection", args: { bookId: "wrong" } })).rejects.toMatchObject({ code: "ui/invalid-target" });
  expect(calls).toHaveLength(1); expect(tool.executionMode).toBe("sequential");
});
