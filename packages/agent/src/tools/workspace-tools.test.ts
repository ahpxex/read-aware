import { expect, test } from "bun:test";
import { AppError, type WorkspaceSnapshot } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildAgentTools } from "./registry";
import { workspaceToolSnapshot } from "./workspace-tools";

test("both agent scopes use the shared workspace port with cancellation, guards and original failures", async () => {
  for (const scope of [{ kind: "global", threadId: "global" }, { kind: "book", bookId: "book" }] as const) {
    const { deps } = createInMemoryDeps(), calls: unknown[] = [], error = new AppError("ui/superseded", "stale");
    deps.workspace.navigate = async (...args) => { calls.push(args); throw error; };
    const tools = buildAgentTools(scope, deps), tool = tools.find(t => t.name === "navigate_app")!;
    expect(tools.some(t => t.name === "get_workspace")).toBe(true);
    const abort = new AbortController();
    expect(await tool.execute("test", { target: { surface: "stats" }, expectedRevision: 2 }, abort.signal).catch(e => e)).toBe(error);
    expect(calls).toEqual([[{ surface: "stats" }, 2, abort.signal]]);
    abort.abort(error); await expect(tool.execute("test", { target: { surface: "stats" } }, abort.signal)).rejects.toBe(error);
    expect(calls.length).toBe(1);
  }
});
test("maximal JSON-escaped fields fit the model budget without losing selection continuation", () => {
  const ids = Array.from({ length: 100 }, (_, n) => `${n}`.padStart(3, "0") + "\u0001".repeat(253));
  const snapshot: WorkspaceSnapshot = { revision: 10, surface: "shelf", collectionId: "\u0001".repeat(256),
    settings: { open: true, section: `plugin:${"\u0001".repeat(256)}` }, search: { open: true, query: "\u0001".repeat(4096) },
    selection: { active: true, total: 100, bookIds: ids, nextCursor: null } };
  const result = workspaceToolSnapshot(snapshot);
  expect(JSON.stringify({ status: "completed", snapshot: result }).length).toBeLessThan(16_000);
  expect(result.selection.bookIds.length).toBeGreaterThan(0); expect(result.selection.bookIds.length).toBeLessThan(100);
  expect(result.selection.nextCursor).toBe(result.selection.bookIds[result.selection.bookIds.length - 1]);
  expect(result.selection.total).toBe(100); expect(result.search.queryTruncated).toBe(true); expect(snapshot.selection.bookIds.length).toBe(100);
});
