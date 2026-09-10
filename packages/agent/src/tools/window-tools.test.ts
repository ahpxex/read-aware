import { expect, test } from "bun:test";
import { AppError, type HostWindowRequest } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildAgentTools } from "./registry";

test("both Agent scopes use the same window port, strict intents and cancellation", async () => {
  for (const scope of [{ kind: "global", threadId: "window" }, { kind: "book", bookId: "book" }] as const) {
    const { deps } = createInMemoryDeps(), calls: HostWindowRequest[] = [];
    deps.window.snapshot = async () => ({ supported: true, revision: 1, minimized: false, maximized: true, fullscreen: false, focused: true });
    deps.window.control = async (request, signal) => {
      signal?.throwIfAborted(); calls.push(request);
      return { status: "requested", snapshot: await deps.window.snapshot() };
    };
    const tools = buildAgentTools(scope, deps);
    const query = tools.find(tool => tool.name === "get_app_window")!, control = tools.find(tool => tool.name === "control_app_window")!;
    expect(JSON.stringify(await query.execute("q", {}))).toContain("maximized");
    await control.execute("c", { request: { action: "fullscreen", enabled: true } });
    expect(calls).toEqual([{ action: "fullscreen", enabled: true }]);
    await expect(control.execute("c", { request: { action: "close" } })).rejects.toMatchObject({ code: "ui/invalid-target" });
    const abort = new AbortController(); abort.abort(new AppError("plugin/cancelled", "Cancelled"));
    await expect(control.execute("c", { request: { action: "restore" } }, abort.signal)).rejects.toMatchObject({ code: "plugin/cancelled" });
    expect(calls).toHaveLength(1);
  }
});
