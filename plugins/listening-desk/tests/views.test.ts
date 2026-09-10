import { expect, test } from "bun:test";
import type { PluginContext, ReadingSessionSnapshot } from "@read-aware/plugin-types";
import { listeningView } from "../src/views";

function fixture() {
  const state: ReadingSessionSnapshot = { revision: 1, sessionId: "session", bookId: "book", status: "ready", location: null,
    visibleText: "private text", selection: null, controls: null, history: { canGoBack: true, canGoForward: false },
    mode: { status: "unavailable", unavailableReason: "no-provider", requestedActive: false, modeKey: null, availableModes: [],
      label: null, unitId: null, units: [], progress: null, cfiRange: null, position: null },
    playback: { status: "stopped", unavailableReason: null, backend: null, fallback: false, owner: null, cfiRange: null } };
  const calls: unknown[] = [];
  const ctx = { locale: "en", services: { session: { environment: async () => ({ networkHint: "online" }) } }, domains: { reading: { queries: { session: async () => state }, commands: {
    controlPlayback: async (...args: unknown[]) => { calls.push(args); state.playback.status = "playing"; },
    back: async (...args: unknown[]) => { calls.push(["back", ...args]); },
    configureMode: async (...args: unknown[]) => { calls.push(["mode", ...args]); },
    returnToMode: async (...args: unknown[]) => { calls.push(["return", ...args]); },
  } } } } as unknown as PluginContext;
  return { ctx, state, calls };
}

test("panel actions preserve their displayed open/close intent and only close after the host receipt", async () => {
  const { ctx, state, calls } = fixture();
  let finish!: () => void;
  const panels = { sessionId: state.sessionId!, bookId: state.bookId!, revision: 1, controlsVisible: true,
    sizes: { toc: 288, chat: 352 }, layout: "docked" as const,
    panels: { toc: { open: true, visible: true }, chat: { open: false, visible: false }, annotations: { open: false, visible: false }, appearance: { open: false, visible: false } } };
  ctx.services.ui = { showToast() {}, exportFile: async () => false, publishView: async () => ({ status: "inactive" }), reader: {
    snapshot: async () => panels, observe: () => ({ dispose() {} }),
    setPanel: async (...args) => { calls.push(args); await new Promise<void>(resolve => { finish = resolve; }); return { status: "completed", panel: args[0], snapshot: panels }; },
  } };
  const view = await listeningView(ctx);
  if (view.kind !== "blocks") throw Error("Expected blocks");
  const row = view.blocks.find(block => block.kind === "actions");
  if (row?.kind !== "actions") throw Error("Expected actions");
  const actions = row.actions.filter(a => a.id.startsWith("panel-")); expect(actions).toHaveLength(4);
  expect(actions[0]!.label).toBe("Close: Contents");
  let settled = false;
  const request = Promise.resolve(actions[0]!.run()).then(value => { settled = true; return value; });
  await Promise.resolve(); expect(settled).toBe(false);
  expect(calls).toEqual([["toc", false, { sessionId: "session", bookId: "book" }]]);
  finish(); expect(await request).toEqual({ close: true });
  ctx.services.ui.reader!.setPanel = async () => { throw Error("stale panel session"); };
  await expect(actions[1]!.run()).rejects.toThrow("stale panel session");
});

test("controls action preserves its displayed intent and guard, and closes only after UI completion", async () => {
  for (const visible of [true, false]) {
    const { ctx, state, calls } = fixture(); state.controls = { visible };
    let finish!: () => void;
    ctx.domains.reading!.commands!.setControls = async (...args) => {
      calls.push(args); await new Promise<void>(resolve => { finish = resolve; });
      return { status: "completed", sessionId: "session", controls: { visible: !visible } };
    };
    const view = await listeningView(ctx);
    if (view.kind !== "blocks") throw Error("Expected blocks");
    const row = view.blocks.find(block => block.kind === "actions");
    if (row?.kind !== "actions") throw Error("Expected actions");
    const action = row.actions.find(action => action.id === "reader-controls")!;
    expect(action.icon).toBe("rows");
    expect(action.label).toBe(visible ? "Hide reader controls" : "Show reader controls");
    state.controls.visible = !visible; state.sessionId = "new-session";
    let settled = false;
    const pending = Promise.resolve(action.run()).then(value => { settled = true; return value; });
    await Promise.resolve(); expect(settled).toBe(false);
    expect(calls).toEqual([[!visible, { sessionId: "session", bookId: "book" }]]);
    finish(); expect(await pending).toEqual({ close: true });
    ctx.domains.reading!.commands!.setControls = async () => { throw Error("session retired"); };
    await expect(action.run()).rejects.toThrow("session retired");
  }
});
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

test("system offline hint is visible but does not disable local playback", async () => {
  const { ctx, calls } = fixture();
  ctx.services.session.environment = async () => ({ revision: 1, runtime: "desktop", platform: "macos", locale: "en", timeZone: "UTC", utcOffsetMinutes: 0, networkHint: "offline" });
  const view = await listeningView(ctx);
  expect(JSON.stringify(view)).toContain("System reports offline");
  if (view.kind !== "blocks") throw Error("Expected blocks");
  const row = view.blocks.find(block => block.kind === "actions");
  if (row?.kind !== "actions") throw Error("Expected actions");
  await row.actions.find(action => action.id === "start")!.run();
  expect(calls[0]).toEqual(["start", { sessionId: "session", bookId: "book" }]);
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

test("provider form recovers a missing selection through the shared guarded command", async () => {
  const { ctx, state, calls } = fixture();
  state.mode = { ...state.mode, modeKey: "missing:mode", requestedActive: true,
    availableModes: [{ key: "available:mode", label: "Available", defaultUnitId: "block", units: [{ id: "block", label: "Block" }] }] };
  const view = await listeningView(ctx);
  if (view.kind !== "blocks") throw new Error("Expected blocks");
  const form = view.blocks.find(block => block.kind === "form");
  if (form?.kind !== "form") throw new Error("Expected provider form");
  expect(await form.onSubmit({ selectModeKey: "not-listed:mode" })).toHaveProperty("fieldErrors.selectModeKey");
  expect(calls).toEqual([]);
  state.sessionId = "new-session";
  await form.onSubmit({ selectModeKey: "available:mode" });
  expect(calls).toEqual([["mode", { active: true, modeKey: "missing:mode", selectModeKey: "available:mode" }, { sessionId: "session", bookId: "book" }]]);
  ctx.domains.reading!.commands!.configureMode = async () => { throw new Error("provider retired"); };
  await expect(form.onSubmit({ selectModeKey: "available:mode" })).rejects.toThrow("provider retired");
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

test("unit controls preserve guards and show terminal boundaries without reporting failures as completion", async () => {
  const { ctx, state, calls } = fixture();
  state.mode = { ...state.mode, status: "ready", requestedActive: true };
  ctx.domains.reading!.commands!.stepMode = async (direction, guard) => {
    calls.push([direction, guard]); return { status: "completed", sessionId: "session", outcome: "end-of-book", mode: state.mode };
  };
  const view = await listeningView(ctx);
  if (view.kind !== "blocks") throw new Error("Expected blocks");
  const row = view.blocks.find(block => block.kind === "actions");
  if (row?.kind !== "actions") throw new Error("Expected actions");
  const next = row.actions.find(action => action.id === "next-unit")!;
  expect(next.icon).toBe("arrow-right");
  state.sessionId = "new-session";
  expect(JSON.stringify(await next.run())).toContain("End of book");
  expect(calls).toEqual([["next", { sessionId: "session", bookId: "book" }]]);
  ctx.domains.reading!.commands!.stepMode = async () => { throw new Error("segmentation failed"); };
  await expect(next.run()).rejects.toThrow("segmentation failed");
});
