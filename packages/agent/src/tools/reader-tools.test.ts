import { expect, test } from "bun:test";
import { AppError, type Id, type ReadingNavigationReceipt } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildReaderTools } from "./reader-tools";
import { createAgentTurnState } from "./turn-state";
import { contextPolicyState } from "../testing/reading-context-policy";

const bookId = "book" as Id;
const receipt: ReadingNavigationReceipt = {
  status: "completed", sessionId: "session",
  location: { bookId, contentVersion: "sha256:fixture", cfi: "actual" },
};
function fixture() {
  const { deps, stores } = createInMemoryDeps({ books: [{ id: bookId, title: "Reading test", progressPercent: 0, status: "reading" }] });
  const tools = buildReaderTools({ kind: "book", bookId }, deps);
  const tool = (name: string) => tools.find(tool => tool.name === name)!;
  return { deps, stores, tool };
}

test("session selection is versioned and withheld with privacy restrictions, spoilers and another book", async () => {
  const { deps } = fixture();
  await deps.reader.openBook(bookId);
  const original = await deps.reader.getSession();
  const selection = { id: "selected", text: "needle", textLength: 6,
    range: { bookId, contentVersion: "v1", cfi: "epubcfi(/6/2)", textQuote: { exact: "needle", prefix: "private context" } } };
  deps.reader.getSession = async () => ({ ...original, selection });
  const state = createAgentTurnState(), policy = contextPolicyState({ selection: true, surrounding: true });
  deps.readingContextPolicy = policy;
  const read = async () => {
    const result = await buildReaderTools({ kind: "book", bookId }, deps, state).find(t => t.name === "get_reading_session")!.execute("selection", {});
    if (result.content[0]?.type !== "text") throw Error("Expected text");
    return JSON.parse(result.content[0].text);
  };
  expect((await read()).selection).toEqual(selection);
  for (const permissions of [{ selection: false, surrounding: true }, { selection: true, surrounding: false }]) {
    policy.set(permissions);
    expect((await read()).selection).toBeNull();
  }
  policy.set({ selection: true, surrounding: true }); state.spoilerFence = { throughChapterIndex: 0 };
  expect((await read()).selection).toBeNull();
  state.spoilerPermissionGranted = true;
  expect((await read()).selection).toEqual(selection);
  deps.reader.getSession = async () => ({ ...original, bookId: "other", selection });
  expect(await read()).toEqual({ status: "not-active", bookId });
  expect(policy.listeners()).toBe(0);
});

test("open_book only reports opened after the renderer completes, preserving its actual location", async () => {
  const { deps, tool } = fixture();
  let finish!: (receipt: ReadingNavigationReceipt) => void;
  deps.reader.openBook = () => new Promise(resolve => { finish = resolve; });
  let completed = false;
  const pending = tool("open_book").execute("test", {}).then(result => { completed = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(completed).toBe(false);
  finish(receipt);
  const result = await pending;
  expect(result.content[0]).toMatchObject({ type: "text" });
  if (result.content[0]?.type !== "text") throw new Error("Expected text");
  expect(JSON.parse(result.content[0].text)).toMatchObject({ opened: true, ...receipt });
});

test("open_book propagates a failed host navigation without a success acknowledgement", async () => {
  const { deps, tool } = fixture();
  deps.reader.goTo = async () => { throw new AppError("reader/target-not-found", "Missing"); };
  await expect(tool("open_book").execute("test", { anchor: "missing" })).rejects.toMatchObject({ code: "reader/target-not-found" });
});

test("versioned fraction targets and cancellation reach the reader port unchanged", async () => {
  const { deps, tool } = fixture(); const abort = new AbortController();
  let passedSignal: AbortSignal | undefined;
  let passedTarget: unknown;
  deps.reader.goTo = async (target, signal) => { passedTarget = target; passedSignal = signal; return receipt; };
  await tool("open_book").execute("test", { fraction: 0.4, contentVersion: "sha256:fixture" }, abort.signal);
  expect(passedSignal).toBe(abort.signal);
  expect(passedTarget).toMatchObject({ bookId, fraction: 0.4, contentVersion: "sha256:fixture" });
});

test("book-scoped controls pass both session and book guards to the host", async () => {
  const { deps, tool } = fixture(); const abort = new AbortController();
  const snapshot = await deps.reader.getSession();
  let passedGuard: unknown; let passedSignal: AbortSignal | undefined;
  deps.reader.back = async (signal, guard) => { passedGuard = guard; passedSignal = signal; return receipt; };
  await tool("navigate_reading").execute("test", { action: "back" }, abort.signal);
  expect(passedGuard).toEqual({ sessionId: snapshot.sessionId, bookId });
  expect(passedSignal).toBe(abort.signal);
});

test("another book's viewport is neither exposed nor controlled by a book-scoped turn", async () => {
  const { deps, stores, tool } = fixture();
  await deps.reader.openBook("other" as Id);
  const count = stores.readerRequests.length;
  const result = await tool("get_reading_session").execute("test", {});
  if (result.content[0]?.type !== "text") throw new Error("Expected text");
  expect(JSON.parse(result.content[0].text)).toEqual({ status: "not-active", bookId });
  await expect(tool("navigate_reading").execute("test", { action: "next" })).rejects.toThrow("not the active reader");
  await expect(tool("control_read_aloud").execute("test", { action: "stop" })).rejects.toThrow("not the active reader");
  await expect(tool("configure_reading_mode").execute("test", { active: false })).rejects.toThrow("not the active reader");
  await expect(tool("set_reader_controls").execute("test", { visible: true })).rejects.toThrow("not the active reader");
  const panels = await tool("get_reader_panels").execute("test", {});
  expect(panels.content[0]).toMatchObject({ type: "text", text: "null" });
  await expect(tool("set_reader_panel").execute("test", { panel: "chat", open: true })).rejects.toMatchObject({ code: "reader/superseded" });
  await expect(tool("set_reader_panel_width").execute("test", { panel: "chat", width: 400 })).rejects.toMatchObject({ code: "reader/superseded" });
  expect(stores.readerRequests).toHaveLength(count);
});
test("panel width tool preserves scope guards, cancellation and storage failure", async () => {
  const { deps, tool } = fixture(); const abort = new AbortController();
  const snapshot = await deps.reader.getPanels(); let passed: unknown;
  deps.reader.setPanelWidth = async (...args) => { passed = args; return { status: "completed", panel: "chat", snapshot: snapshot! }; };
  await tool("set_reader_panel_width").execute("test", { panel: "chat", width: 400 }, abort.signal);
  expect(passed).toEqual(["chat", 400, abort.signal, { bookId, sessionId: snapshot!.sessionId }]);
  deps.reader.setPanelWidth = async () => { throw new AppError("db/locked", "private"); };
  await expect(tool("set_reader_panel_width").execute("test", { panel: "chat", width: 400 })).rejects.toMatchObject({ code: "db/locked" });
});

test("panel tools wait for the shared UI service, retain guards and forward errors and cancellation", async () => {
  const { deps, tool } = fixture(); const abort = new AbortController();
  const current = await deps.reader.getPanels();
  let observed: unknown, finish!: () => void;
  deps.reader.setPanel = async (...args) => {
    observed = args; await new Promise<void>(resolve => { finish = resolve; });
    return { status: "completed", panel: "chat", snapshot: current! };
  };
  let settled = false;
  const request = tool("set_reader_panel").execute("test", { panel: "chat", open: true }, abort.signal).then(value => { settled = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 0)); expect(settled).toBe(false);
  expect(observed).toEqual(["chat", true, abort.signal, { sessionId: current!.sessionId, bookId }]);
  finish(); await request; expect(settled).toBe(true);
  deps.reader.setPanel = async () => { throw new AppError("db/locked", "private"); };
  await expect(tool("set_reader_panel").execute("test", { panel: "chat", open: true })).rejects.toMatchObject({ code: "db/locked" });
  deps.reader.getPanels = async () => null;
  await expect(tool("set_reader_panel").execute("test", { panel: "chat", open: true })).rejects.toMatchObject({ code: "reader/unavailable" });
});

test("reader chrome tool waits for UI completion and carries cancellation and both scope guards", async () => {
  const { deps, tool } = fixture(); const abort = new AbortController();
  let observed: unknown; let finish!: () => void;
  deps.reader.setControls = async (visible, signal, guard) => {
    observed = { visible, signal, guard };
    await new Promise<void>(resolve => { finish = resolve; });
    return { status: "completed", sessionId: "fixture", controls: { visible } };
  };
  let settled = false;
  const pending = tool("set_reader_controls").execute("test", { visible: false }, abort.signal)
    .then(value => { settled = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(settled).toBe(false);
  expect(observed).toEqual({ visible: false, signal: abort.signal, guard: { sessionId: "fixture", bookId } });
  finish();
  const result = await pending;
  if (result.content[0]?.type !== "text") throw Error("Expected text");
  expect(JSON.parse(result.content[0].text)).toMatchObject({ status: "completed", controls: { visible: false } });
  deps.reader.setControls = async () => { throw new AppError("reader/timeout", "No render"); };
  await expect(tool("set_reader_controls").execute("test", { visible: true })).rejects.toMatchObject({ code: "reader/timeout" });
});

test("read-aloud forwards session scope and cancellation and waits for backend completion", async () => {
  const { deps, tool } = fixture(); const abort = new AbortController();
  const session = await deps.reader.getSession();
  let observed: unknown;
  let done!: () => void;
  deps.reader.controlPlayback = async (action, signal, guard) => {
    observed = { action, signal, guard };
    await new Promise<void>(resolve => { done = resolve; });
    return { status: "completed", sessionId: "fixture", playback: { ...session.playback, status: "playing", owner: "agent" } };
  };
  let settled = false;
  const pending = tool("control_read_aloud").execute("test", { action: "start" }, abort.signal).then(result => { settled = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(settled).toBe(false);
  expect(observed).toEqual({ action: "start", signal: abort.signal, guard: { sessionId: "fixture", bookId } });
  done();
  const result = await pending;
  expect(result.content[0]).toMatchObject({ type: "text" });
});

test("an annotation without a location does not silently succeed as an open-book action", async () => {
  const { deps, stores, tool } = fixture();
  deps.annotations.getAnnotation = async () => ({ kind: "note", id: "note" as Id, bookId, body: "Unanchored", createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z" });
  await expect(tool("open_book").execute("test", { annotationId: "note" })).rejects.toThrow("no navigable location");
  expect(stores.readerRequests).toHaveLength(0);
});

test("mode tool passes declared unit, provider, session scope and signal and waits for indexing", async () => {
  const { deps, tool } = fixture();
  const abort = new AbortController(); const session = await deps.reader.getSession();
  let observed: unknown; let finish!: () => void;
  deps.reader.configureMode = async (input, signal, guard) => {
    observed = { input, signal, guard };
    await new Promise<void>(resolve => { finish = resolve; });
    return { status: "completed", sessionId: session.sessionId!, mode: { ...session.mode, status: "ready" } };
  };
  const input = { active: true, modeKey: "test:mode", selectModeKey: "selected:mode", unitId: "paragraph" };
  let settled = false;
  const pending = tool("configure_reading_mode").execute("test", input, abort.signal).then(result => { settled = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(settled).toBe(false);
  expect(observed).toEqual({ input, signal: abort.signal, guard: { bookId, sessionId: session.sessionId } });
  finish();
  const result = await pending;
  if (result.content[0]?.type !== "text") throw new Error("Expected text");
  expect(JSON.parse(result.content[0].text)).toMatchObject({ status: "completed", mode: { status: "ready" } });
});

test("return-to-unit forwards the session scope and never reports dispatch as completion", async () => {
  const { deps, tool } = fixture(); const abort = new AbortController();
  let observed: unknown; let finish!: () => void;
  deps.reader.returnToMode = async (signal, guard) => {
    observed = { signal, guard }; await new Promise<void>(resolve => { finish = resolve; }); return receipt;
  };
  let settled = false;
  const work = tool("navigate_reading").execute("test", { action: "return-to-unit" }, abort.signal).then(value => { settled = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(settled).toBe(false);
  expect(observed).toEqual({ signal: abort.signal, guard: { sessionId: "fixture", bookId } });
  finish(); await work;
});

test("an exact annotation lookup cannot navigate a different target book", async () => {
  const { deps, stores, tool } = fixture();
  deps.annotations.getAnnotation = async () => ({ kind: "note", id: "note" as Id, bookId: "other" as Id, body: "Other book", anchor: "other-anchor", createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z" });
  await expect(tool("open_book").execute("test", { annotationId: "note" })).rejects.toThrow("annotation not found");
  expect(stores.readerRequests).toHaveLength(0);
});

test("unit navigation forwards cancellation and scope and preserves boundary outcomes", async () => {
  const { deps, tool } = fixture(); const abort = new AbortController();
  const observed: unknown[] = [];
  deps.reader.stepMode = async (direction, signal, guard) => {
    observed.push({ direction, signal, guard });
    return { status: "completed", sessionId: "fixture", outcome: "end-of-book", mode: (await deps.reader.getSession()).mode };
  };
  const result = await tool("navigate_reading").execute("test", { action: "next-unit" }, abort.signal);
  expect(JSON.stringify(result)).toContain("end-of-book");
  expect(observed).toEqual([{ direction: "next", signal: abort.signal, guard: { sessionId: "fixture", bookId } }]);
});
