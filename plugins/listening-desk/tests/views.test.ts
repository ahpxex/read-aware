import { expect, test } from "bun:test";
import type { PluginContext, ReadingSessionSnapshot } from "@read-aware/plugin-types";
import { listeningView } from "../src/views";

function fixture() {
  const state: ReadingSessionSnapshot = { revision: 1, sessionId: "session", bookId: "book", status: "ready", location: null,
    visibleText: "private text", history: { canGoBack: true, canGoForward: false },
    playback: { status: "stopped", unavailableReason: null, backend: null, fallback: false, owner: null, cfiRange: null } };
  const calls: unknown[] = [];
  const ctx = { locale: "en", domains: { reading: { queries: { session: async () => state }, commands: {
    controlPlayback: async (...args: unknown[]) => { calls.push(args); state.playback.status = "playing"; },
    back: async (...args: unknown[]) => { calls.push(["back", ...args]); },
  } } } } as unknown as PluginContext;
  return { ctx, state, calls };
}
test("composition exposes available actions, not raw passage text, and guards all writes", async () => {
  const { ctx, calls } = fixture();
  const view = await listeningView(ctx);
  if (view.kind !== "blocks") throw new Error("Expected blocks");
  const row = view.blocks.find(block => block.kind === "actions");
  if (row?.kind !== "actions") throw new Error("Expected actions");
  expect(row.actions.map(action => action.id)).toEqual(["start", "back", "refresh"]);
  expect(JSON.stringify(view)).not.toContain("private text");
  await row.actions[0]!.run();
  expect(calls[0]).toEqual(["start", { sessionId: "session", bookId: "book" }]);
  await row.actions[1]!.run();
  expect(calls[1]).toEqual(["back", { sessionId: "session", bookId: "book" }]);
});
test("unavailable playback offers refresh, not a start that would silently do nothing", async () => {
  const { ctx, state } = fixture();
  state.playback.status = "unavailable"; state.playback.unavailableReason = "mode-inactive";
  state.history.canGoBack = false;
  const view = await listeningView(ctx);
  if (view.kind !== "blocks") throw new Error("Expected blocks");
  const row = view.blocks.find(block => block.kind === "actions");
  if (row?.kind !== "actions") throw new Error("Expected actions");
  expect(row.actions.map(action => action.id)).toEqual(["refresh"]);
  expect(JSON.stringify(view)).toContain("Text-unit mode is inactive");
});
