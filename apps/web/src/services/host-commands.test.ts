import { expect, test } from "bun:test";
import { AppError, HOST_COMMAND_IDS, PARAMETERLESS_HOST_COMMAND_IDS, normalizeHostCommandRequest, type SettingsSnapshot, type WorkspaceSnapshot } from "@read-aware/core";
import { createHostCommands } from "./host-commands";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(overrides: Partial<Parameters<typeof createHostCommands>[0]> = {}) {
  let state: WorkspaceSnapshot = { revision: 7, surface: "shelf", collectionId: "collection",
    settings: { open: false, section: null }, search: { open: false, query: "" },
    selection: { active: true, total: 2, bookIds: ["a", "b"], nextCursor: null } };
  const calls: unknown[] = [];
  const settings = {
    queries: { snapshot: async () => ({ revision: 1, settings: [
      { path: "shelf.layout", value: "grid", writable: true },
      { path: "shelf.sort", value: "recent", writable: true },
      { path: "shelf.group", value: "none", writable: true },
    ] } as SettingsSnapshot) },
    commands: { update: async (...args: unknown[]) => { calls.push(["settings", ...args]); return { changed: [], settings: await settings.queries.snapshot() }; } },
  };
  const workspace = { snapshot: () => structuredClone(state), navigate: async (...args: unknown[]) => {
    calls.push(["workspace", ...args]); return { status: "completed" as const, snapshot: state };
  } };
  const api = createHostCommands({ settings, workspace, canReadWorkspace: true, canNavigate: true, canCloseReader: false,
    openBook: async (...args) => { calls.push(["reading", ...args]); },
    title: id => id, ...overrides });
  return { api, calls, settings, workspace, get state() { return state; }, set state(next) { state = next; } };
}

test("command requests are a finite, parameterless vocabulary with copied revision guards", () => {
  for (const value of [null, [], {}, { id: "import" }, { id: "book-a" }, { id: "go-stats", args: {} },
    { id: "go-stats", expectedWorkspaceRevision: -1 }, { id: "go-stats", expectedWorkspaceRevision: 0.1 },
    { id: "go-stats", expectedWorkspaceRevision: Number.MAX_SAFE_INTEGER + 1 }]) {
    expect(() => normalizeHostCommandRequest(value)).toThrow("Invalid host command request");
  }
  const request = { id: "go-stats", expectedWorkspaceRevision: 0 };
  const accepted = normalizeHostCommandRequest(request); request.id = "import";
  expect(accepted).toEqual({ id: "go-stats", expectedWorkspaceRevision: 0 });
  expect(new Set(HOST_COMMAND_IDS).size).toBe(18);
});

test("discovery exposes only authorized checked values and separate navigation and reader permissions", async () => {
  const f = fixture();
  expect((await f.api.list()).commands).toHaveLength(18);
  expect((await f.api.list()).commands.find(c => c.id === "layout-grid")).toMatchObject({ checked: true, enabled: true });
  f.settings.queries.snapshot = async () => ({ settings: [] } as unknown as SettingsSnapshot);
  expect((await f.api.list()).commands.find(c => c.id === "layout-grid")).toEqual({ id: "layout-grid", title: "layout-grid",
    enabled: false, unavailableReason: "permission", settingsPath: "shelf.layout",
    parameters: { type: "object", properties: {}, additionalProperties: false } });
  f.state = { ...f.state, surface: "reader" };
  const commands = (await f.api.list()).commands;
  expect(commands.find(c => c.id === "go-stats")).toMatchObject({ enabled: false, unavailableReason: "reader-control" });
  expect(commands.find(c => c.id === "open-settings")?.enabled).toBe(true);
  await expect(f.api.execute({ id: "go-stats" })).rejects.toMatchObject({ code: "ui/unavailable" });
  expect(f.calls).toEqual([]);
  expect((await fixture({ canNavigate: false }).api.list()).commands.every(c => c.unavailableReason === "permission")).toBe(true);
  const hidden = await fixture({ canReadWorkspace: false }).api.list();
  expect(hidden.workspaceRevision).toBeNull(); expect(hidden.commands.every(c => !c.enabled)).toBe(true);
});

test("settings commit precedes navigation, which preserves collection and the full selection", async () => {
  const f = fixture(), entered = deferred(), hold = deferred();
  f.settings.commands.update = async (...args) => { f.calls.push(["settings", ...args]); entered.resolve(); await hold.promise;
    return { changed: [], settings: await f.settings.queries.snapshot() }; };
  const request = { id: "layout-list", expectedWorkspaceRevision: 7 };
  const running = f.api.execute(request); request.id = "sort-title";
  await entered.promise; expect(f.calls.length).toBe(1); hold.resolve();
  expect(await running).toEqual({ commandId: "layout-list", status: "completed", completed: ["settings", "workspace"] });
  expect(f.calls).toEqual([
    ["settings", [{ path: "shelf.layout", value: "list" }], undefined],
    ["workspace", { surface: "shelf", collectionId: "collection", selection: { active: true, bookIds: ["a", "b"] } }, 7, undefined, false],
  ]);
});

test("all IDs map to their existing semantic operation, never menu callbacks", async () => {
  for (const id of PARAMETERLESS_HOST_COMMAND_IDS) {
    const f = fixture({ canCloseReader: true });
    const result = await f.api.execute({ id });
    expect(result.status).toBe("completed");
    const call = f.calls.at(-1) as unknown[];
    expect(call[0]).toBe("workspace"); expect(call[4]).toBe(true);
    if (id.startsWith("layout-") || id.startsWith("sort-") || id.startsWith("group-")) {
      const [kind, value] = id.split("-");
      expect(f.calls[0]).toEqual(["settings", [{ path: `shelf.${kind}`, value }], undefined]);
    } else {
      expect(f.calls).toHaveLength(1);
      expect(call[1]).toEqual(id === "go-context" ? { surface: "agent" } : id === "go-stats" ? { surface: "stats" }
        : id === "open-settings" ? { surface: "settings", section: "general" }
          : { surface: "shelf", collectionId: null, ...(id === "select" ? { selection: { active: true, bookIds: [] } } : {}) });
    }
  }
});

test("preflight failure has no effects; post-commit failure gives a truthful partial receipt", async () => {
  const f = fixture();
  await expect(f.api.execute({ id: "layout-list", expectedWorkspaceRevision: 6 })).rejects.toMatchObject({ code: "ui/superseded" });
  f.state.selection.total = 1001;
  await expect(f.api.execute({ id: "layout-list" })).rejects.toMatchObject({ code: "ui/unavailable" });
  expect(f.calls).toEqual([]); f.state.selection.total = 2;
  const failure = new AppError("db/error", "raw SQL must not leak into receipts");
  f.settings.commands.update = async () => { throw failure; };
  await expect(f.api.execute({ id: "layout-list" })).rejects.toBe(failure); expect(f.calls).toEqual([]);
  const g = fixture();
  g.workspace.navigate = async () => { throw new AppError("ui/superseded", "new intent"); };
  expect(await g.api.execute({ id: "layout-list" })).toEqual({ commandId: "layout-list", status: "partial", completed: ["settings"], errorCode: "ui/superseded" });
  await expect(g.api.execute({ id: "go-stats" })).rejects.toMatchObject({ code: "ui/superseded" });
});

test("retirement before dispatch does nothing, after a durable write reports partial and never navigates", async () => {
  const f = fixture(), abort = new AbortController(), failure = new AppError("plugin/cancelled", "retired");
  abort.abort(failure);
  await expect(f.api.execute({ id: "go-stats" }, abort.signal)).rejects.toBe(failure); expect(f.calls).toEqual([]);
  const g = fixture(), controller = new AbortController();
  g.settings.commands.update = async () => { controller.abort(failure); return { changed: [], settings: await g.settings.queries.snapshot() }; };
  expect(await g.api.execute({ id: "layout-list" }, controller.signal)).toEqual({ commandId: "layout-list", status: "partial", completed: ["settings"], errorCode: "plugin/cancelled" });
  expect(g.calls).toEqual([]);
  const h = fixture(), late = new AbortController();
  h.settings.queries.snapshot = async () => { late.abort(failure); return { settings: [] } as unknown as SettingsSnapshot; };
  await expect(h.api.list(late.signal)).rejects.toBe(failure);
});

test("unattached workspace is unavailable, while unexpected snapshot failures remain failures", async () => {
  const f = fixture(); f.workspace.snapshot = () => { throw new AppError("ui/unavailable", "detached"); };
  expect((await f.api.list()).commands.every(c => c.unavailableReason === "workspace")).toBe(true);
  const failure = new AppError("db/error", "read failure"); f.workspace.snapshot = () => { throw failure; };
  await expect(f.api.list()).rejects.toBe(failure);
});

test("resource commands require exactly their own bounded ID and copy it before waiting", () => {
  for (const input of [{ id: "open-book" }, { id: "open-book", args: {} },
    { id: "open-book", args: { bookId: " " } }, { id: "open-book", args: { bookId: "a".repeat(257) } },
    { id: "open-book", args: { collectionId: "c" } }, { id: "open-book", args: { bookId: "b", extra: true } },
    { id: "open-collection", args: { bookId: "b" } }, { id: "go-stats", args: { bookId: "b" } }]) {
    expect(() => normalizeHostCommandRequest(input)).toThrow();
  }
  const input = { id: "open-book", args: { bookId: "book" }, expectedWorkspaceRevision: 7 };
  const accepted = normalizeHostCommandRequest(input); input.args.bookId = "changed";
  expect(accepted).toEqual({ id: "open-book", args: { bookId: "book" }, expectedWorkspaceRevision: 7 });
});

test("typed resource commands use real reader completion and validated workspace navigation", async () => {
  const hold = deferred(), entered = deferred(), calls: unknown[] = [];
  const f = fixture({ canCloseReader: true, openBook: async (...args) => { calls.push(args); entered.resolve(); await hold.promise; } });
  const list = await f.api.list();
  expect(list.commands.find(c => c.id === "open-book")?.parameters).toEqual({ type: "object",
    properties: { bookId: { type: "string", minLength: 1, maxLength: 256 } }, required: ["bookId"], additionalProperties: false });
  const request = { id: "open-book", args: { bookId: "book" } }; let settled = false;
  const pending = f.api.execute(request).then(result => { settled = true; return result; });
  request.args.bookId = "mutated"; await entered.promise;
  expect(settled).toBe(false); expect(calls).toEqual([["book", undefined]]); expect(f.calls).toEqual([]);
  hold.resolve(); expect(await pending).toEqual({ commandId: "open-book", status: "completed", completed: ["reading"] });
  await f.api.execute({ id: "open-collection", args: { collectionId: "destination" } });
  expect(f.calls).toEqual([["workspace", { surface: "shelf", collectionId: "destination" }, 7, undefined, true]]);
  const denied = fixture();
  expect((await denied.api.list()).commands.find(c => c.id === "open-book")).toMatchObject({ enabled: false, unavailableReason: "reader-control" });
  await expect(denied.api.execute({ id: "open-book", args: { bookId: "book" } })).rejects.toMatchObject({ code: "ui/unavailable" });
  expect(denied.calls).toEqual([]);
  const error = new AppError("reader/book-not-found", "missing");
  const failing = fixture({ canCloseReader: true, openBook: async () => { throw error; } });
  await expect(failing.api.execute({ id: "open-book", args: { bookId: "missing" } })).rejects.toBe(error);
});
