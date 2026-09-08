import { expect, test } from "bun:test";
import type { PluginContext, ReadingSessionSnapshot } from "@read-aware/plugin-types";
import { listeningView } from "../src/views";

function fixture() {
  const state: ReadingSessionSnapshot = { revision: 1, sessionId: "session", bookId: "book", status: "ready", location: null,
    visibleText: "private text", history: { canGoBack: true, canGoForward: false },
    mode: { status: "unavailable", unavailableReason: "no-provider", requestedActive: false, modeKey: null,
      label: null, unitId: null, units: [], progress: null, cfiRange: null, position: null },
    playback: { status: "stopped", unavailableReason: null, backend: null, fallback: false, owner: null, cfiRange: null } };
  const calls: unknown[] = [];
  const ctx = { locale: "en", domains: { reading: { queries: { session: async () => state }, commands: {
    controlPlayback: async (...args: unknown[]) => { calls.push(args); state.playback.status = "playing"; },
    back: async (...args: unknown[]) => { calls.push(["back", ...args]); },
    configureMode: async (...args: unknown[]) => { calls.push(["mode", ...args]); },
    returnToMode: async (...args: unknown[]) => { calls.push(["return", ...args]); },
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
  expect(view.blocks.some(block => block.kind === "form")).toBe(false);
});

test("mode form validates declared units and retains its session and provider preconditions", async () => {
  const { ctx, state, calls } = fixture();
  state.mode = { ...state.mode, status: "inactive", unavailableReason: null, modeKey: "sentence-reader:mode", label: "Sentence Reader",
    unitId: "sentence", units: [{ id: "sentence", label: "Sentence" }, { id: "paragraph", label: "Paragraph" }] };
  const view = await listeningView(ctx);
  if (view.kind !== "blocks") throw new Error("Expected blocks");
  const form = view.blocks.find(block => block.kind === "form");
  if (form?.kind !== "form") throw new Error("Expected form");
  expect(await form.onSubmit({ active: true, unitId: "missing" })).toHaveProperty("fieldErrors.unitId");
  expect(await form.onSubmit({ active: "true", unitId: "sentence" })).toHaveProperty("fieldErrors.active");
  expect(calls).toEqual([]);
  state.sessionId = "new-session";
  await form.onSubmit({ active: true, unitId: "paragraph" });
  expect(calls).toEqual([["mode", { active: true, unitId: "paragraph", modeKey: "sentence-reader:mode" }, { sessionId: "session", bookId: "book" }]]);
});

test("mode form propagates an indexing failure instead of navigating to a success view", async () => {
  const { ctx, state } = fixture();
  state.mode = { ...state.mode, status: "inactive", unavailableReason: null, modeKey: "test:mode", unitId: "sentence", units: [{ id: "sentence", label: "Sentence" }] };
  ctx.domains.reading!.commands!.configureMode = async () => { throw new Error("indexing failed"); };
  const view = await listeningView(ctx);
  if (view.kind !== "blocks") throw new Error("Expected blocks");
  const form = view.blocks.find(block => block.kind === "form");
  if (form?.kind !== "form") throw new Error("Expected form");
  await expect(form.onSubmit({ active: true, unitId: "sentence" })).rejects.toThrow("indexing failed");
});

test("resting position offers a guarded return action even when the viewport has left the unit", async () => {
  const { ctx, state, calls } = fixture();
  state.mode = { ...state.mode, requestedActive: true, position: { modeKey: "test:mode", unitId: "sentence", location: { bookId: "book", contentVersion: "v1", cfi: "resting" } } };
  const view = await listeningView(ctx);
  if (view.kind !== "blocks") throw new Error("Expected blocks");
  const row = view.blocks.find(block => block.kind === "actions");
  if (row?.kind !== "actions") throw new Error("Expected actions");
  const action = row.actions.find(action => action.id === "return-to-unit");
  expect(action?.icon).toBe("book-bookmark");
  expect(action).toBeDefined();
  await action!.run();
  expect(calls[0]).toEqual(["return", { sessionId: "session", bookId: "book" }]);
});
