import { expect, test } from "bun:test";
import type { PluginDocument, PluginDocumentChange, PluginModule, PluginToolDefinition, ReadingSessionSnapshot } from "@read-aware/plugin-types";
import { registerBookmarkTools } from "../src/bookmark-tools";
import type { JumperContext } from "../src/types";

function fixture() {
  const target = { bookId: "book", contentVersion: "v1", cfi: "epubcfi(/6/2)" };
  const session = { status: "ready", sessionId: "session", bookId: "book", location: target, selection: null } as ReadingSessionSnapshot;
  const documents = new Map<string, PluginDocument>();
  const writes: PluginDocumentChange[][] = [], moves: unknown[] = [], queries: unknown[] = [];
  let fail = false, conflict = false, stale = false, revision = 0;
  const ctx = { locale: "en", domains: {
    reading: { queries: { session: async () => session }, commands: { goTo: async (value: unknown) => { if (fail) throw Object.assign(Error("source changed"), { code: "reader/stale-location" }); moves.push(value); } }, events: { observeSession: () => ({ dispose() {} }) } },
    library: { queries: { books: { get: async (id: string) => ({ id, title: "Test Book" }) } } },
  }, services: { storage: {
    collection: () => ({ get: async (id: string) => structuredClone(documents.get(id) ?? null),
      page: async (query: unknown) => { queries.push(query); return stale ? { status: "stale-cursor" } : { status: "ready", items: [...documents.values()], nextCursor: "next" }; } }),
    applyDocuments: async (changes: PluginDocumentChange[]) => {
      if (fail) throw Object.assign(Error("locked"), { code: "db/locked" });
      writes.push(structuredClone(changes));
      if (conflict || changes.some(change => (documents.get(change.id)?.revision ?? null) !== change.expectedRevision)) return { status: "conflict", index: 0 };
      for (const change of changes) {
        if (change.kind === "delete") documents.delete(change.id);
        if (change.kind === "put") documents.set(change.id, { id: change.id, data: structuredClone(change.data), revision: `r${++revision}`, updatedAt: "2026-09-11T00:00:00Z" });
      }
      return { status: "applied", documents: [] };
    },
  } } } as unknown as JumperContext;
  const tools: PluginToolDefinition[] = [];
  Object.assign(ctx, { contributions: { agentTools: { register: (tool: PluginToolDefinition) => { tools.push(tool); return { dispose() {} }; } } } });
  registerBookmarkTools(ctx);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    await tools.find(tool => tool.name === name)!.execute(args) as Record<string, unknown>;
  const inspect = async (kind = "location") => call("inspect_bookmark_location", { kind });
  const save = async (preview: Record<string, unknown>, name = "Saved") => call("save_bookmark", {
    kind: preview.kind, bookId: preview.bookId, locationToken: preview.locationToken, name,
  });
  const seed = (data: unknown = { version: 1, name: "Saved", bookTitle: "Test Book", kind: "location", target }) => {
    documents.set("saved", { id: "saved", data: structuredClone(data), revision: `r${++revision}`, updatedAt: "2026-09-11T00:00:00Z" });
    return documents.get("saved")!;
  };
  return { ctx, tools, call, inspect, save, seed, session, documents, writes, moves, queries,
    fail: () => { fail = true; }, conflict: () => { conflict = true; }, stale: () => { stale = true; } };
}

test("inspection has no side effects; save matches the exact inspected target before storing", async () => {
  const f = fixture(), preview = await f.inspect();
  expect(preview.locationToken).toMatch(/^bm1:[a-f0-9]{64}$/);
  expect(preview).not.toHaveProperty("target"); expect(f.writes).toHaveLength(0);
  f.session.location!.cfi = "epubcfi(/6/4)";
  expect(await f.save(preview)).toEqual({ status: "stale-location" });
  expect(f.writes).toHaveLength(0);
  const fresh = await f.inspect();
  const saved = await f.save(fresh, "  Named  ");
  expect(saved).toMatchObject({ status: "saved", name: "Named", bookId: "book" });
  expect(f.writes[0]![0]).toMatchObject({ kind: "put", expectedRevision: null, data: { name: "Named", target: { cfi: "epubcfi(/6/4)" } } });
  expect(f.moves).toHaveLength(0);
});

test("Agent bookmark search passes the complete query with its cursor and rejects invalid input before dispatch", async () => {
  const f = fixture(); f.seed();
  await f.call("list_bookmarks", { bookId: "book", query: " École 中文 ", cursor: "seen", limit: 2 });
  expect(f.queries[0]).toEqual({ bookId: "book", query: "École 中文", cursor: "seen", limit: 2 });
  for (const query of ["中".repeat(342), "bad\nquery", 5]) {
    await expect(f.call("list_bookmarks", { query })).rejects.toMatchObject({ code: "plugin/invalid-input" });
  }
  expect(f.queries).toHaveLength(1);
  expect(f.writes).toHaveLength(0);
});

test("selection tokens include version and disambiguating quote; no viewport fallback", async () => {
  const f = fixture(); f.session.selection = { id: "selected", text: "Chosen", textLength: 6,
    range: { ...f.session.location!, cfi: "epubcfi(/6/4)", textQuote: { exact: "Chosen", prefix: "Before" } } };
  const preview = await f.inspect("selection");
  f.session.selection.range!.textQuote!.prefix = "Another";
  expect(await f.save(preview)).toEqual({ status: "stale-location" });
  const fresh = await f.inspect("selection");
  expect(await f.save(fresh)).toMatchObject({ status: "saved" });
  f.session.selection.range = null;
  await expect(f.save(fresh)).rejects.toMatchObject({ code: "reader/stale-location" });
  expect(f.writes).toHaveLength(1);
});

test("wrong inspected book and changed source version refuse save without writes", async () => {
  const f = fixture(), preview = await f.inspect();
  expect(await f.save({ ...preview, bookId: "other" })).toEqual({ status: "stale-location" });
  f.session.location!.contentVersion = "v2";
  expect(await f.save(preview)).toEqual({ status: "stale-location" });
  expect(f.writes).toHaveLength(0);
});

test("list carries exact cursor/filter and returns bounded metadata, including invalid entries", async () => {
  const f = fixture(), doc = f.seed();
  (doc.data as Record<string, unknown>).bookTitle = "x".repeat(500);
  f.documents.set("bad", { ...doc, id: "bad", data: null });
  const page = await f.call("list_bookmarks", { bookId: "book", cursor: "exact", limit: 20 });
  expect(f.queries[0]).toEqual({ bookId: "book", cursor: "exact", limit: 20 });
  const items = page.items as Record<string, unknown>[];
  expect(items[0]).toMatchObject({ id: "saved", revision: doc.revision, bookTitle: "x".repeat(160), bookTitleTruncated: true });
  expect(items[0]).not.toHaveProperty("target"); expect(items[1]).toMatchObject({ id: "bad", valid: false });
  expect(page.nextCursor).toBe("next");
  f.stale(); expect(await f.call("list_bookmarks", { cursor: "exact" })).toEqual({ status: "stale-cursor" });
});

test("management rejects changed documents and propagates CAS conflicts instead of overwriting", async () => {
  const f = fixture(), doc = f.seed();
  const params = { id: doc.id, expectedRevision: doc.revision };
  expect(await f.call("manage_bookmark", { ...params, action: "open", expectedRevision: "old" })).toEqual({ status: "conflict", id: "saved" });
  expect(f.moves).toHaveLength(0);
  expect(await f.call("manage_bookmark", { ...params, action: "rename", name: "New name" })).toEqual({ status: "renamed", id: "saved" });
  expect(f.writes[0]![0]).toMatchObject({ expectedRevision: params.expectedRevision });
  expect(await f.call("manage_bookmark", { ...params, action: "delete" })).toEqual({ status: "conflict", id: "saved" });
  const fresh = f.documents.get("saved")!;
  f.conflict();
  expect(await f.call("manage_bookmark", { action: "delete", id: fresh.id, expectedRevision: fresh.revision })).toEqual({ status: "conflict", id: "saved" });
  expect(f.documents.size).toBe(1);
});

test("open uses the saved version; delete affects only one private bookmark", async () => {
  const f = fixture(), doc = f.seed(), params = { id: doc.id, expectedRevision: doc.revision };
  expect(await f.call("manage_bookmark", { ...params, action: "open" })).toMatchObject({ status: "completed", action: "open", bookId: "book" });
  expect(f.moves[0]).toMatchObject({ bookId: "book", contentVersion: "v1", cfi: "epubcfi(/6/2)" });
  expect(await f.call("manage_bookmark", { ...params, action: "delete" })).toEqual({ status: "deleted", id: doc.id });
  expect(f.documents.size).toBe(0);
  expect(await f.call("manage_bookmark", { ...params, action: "open" })).toEqual({ status: "not-found", id: doc.id });
});

test("invalid entries can be removed but not opened or renamed; host failures remain failures", async () => {
  const f = fixture(), doc = f.seed(null), params = { id: doc.id, expectedRevision: doc.revision };
  expect(await f.call("manage_bookmark", { ...params, action: "open" })).toMatchObject({ status: "invalid-bookmark" });
  expect(await f.call("manage_bookmark", { ...params, action: "rename", name: "New" })).toMatchObject({ status: "invalid-bookmark" });
  expect(await f.call("manage_bookmark", { ...params, action: "delete" })).toMatchObject({ status: "deleted" });
  const valid = f.seed(); const preview = await f.inspect(); f.fail();
  await expect(f.save(preview)).rejects.toMatchObject({ code: "db/locked" });
  await expect(f.call("manage_bookmark", { action: "open", id: valid.id, expectedRevision: valid.revision })).rejects.toMatchObject({ code: "reader/stale-location" });
});

test("bad arguments are rejected before reads, writes or navigation", async () => {
  const f = fixture();
  for (const args of [{ limit: 0 }, { limit: 21 }, { limit: 1.5 }, { limit: "10" }, { cursor: "" }, { extra: true }]) {
    await expect(f.call("list_bookmarks", args)).rejects.toMatchObject({ code: "plugin/invalid-input" });
  }
  for (const args of [{ action: ["open"], id: "saved", expectedRevision: "r1" },
    { action: "delete", id: "saved", expectedRevision: "r1", name: "unused" }, { action: "rename", id: "saved", expectedRevision: "r1", name: " " }]) {
    await expect(f.call("manage_bookmark", args)).rejects.toMatchObject({ code: "plugin/invalid-input" });
  }
  await expect(f.call("save_bookmark", { name: "New", kind: "location", bookId: "book", locationToken: "made-up" })).rejects.toMatchObject({ code: "plugin/invalid-input" });
  expect(f.queries).toHaveLength(0); expect(f.writes).toHaveLength(0); expect(f.moves).toHaveLength(0);
});

test("compiled registration exposes global-only tools and requires host approval for effects", async () => {
  const f = fixture(), registered: PluginToolDefinition[] = [];
  const registration = { dispose() {}, updateState: async () => ({ status: "applied" }) };
  Object.assign(f.ctx, { contributions: { commands: { register: () => registration }, headerActions: { register: () => registration },
    agentTools: { register: (tool: PluginToolDefinition) => { registered.push(tool); return registration; } } } });
  const plugin = (await import(new URL("../dist/main.js", import.meta.url).href)).default as PluginModule;
  await plugin.activate(f.ctx);
  expect(registered.map(tool => tool.name)).toEqual(["list_bookmarks", "inspect_bookmark_location", "save_bookmark", "manage_bookmark"]);
  expect(registered.every(tool => JSON.stringify(tool.contexts) === '["global"]')).toBe(true);
  expect(registered.map(tool => tool.approval)).toEqual([undefined, undefined, "required", "required"]);
  const preview = await registered[1]!.execute({ kind: "location" }) as Record<string, unknown>;
  const saved = await registered[2]!.execute({ kind: preview.kind, bookId: preview.bookId, locationToken: preview.locationToken, name: "Compiled" });
  expect(saved).toMatchObject({ status: "saved", name: "Compiled" });
  const manifest = await Bun.file(new URL("../dist/manifest.json", import.meta.url)).json();
  expect(manifest.requires.contributions.agentTools).toBe("^1.2.0");
  expect(manifest.permissions).toContain("agent:tools");
});
