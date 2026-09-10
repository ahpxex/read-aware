import { expect, test } from "bun:test";
import type { PluginDetailView, PluginDocument, PluginDocumentChange, PluginFormView, PluginListView, PluginModule, PluginView, PluginViewResult, ReadingSessionSnapshot } from "@read-aware/plugin-types";
import { bookmarkDetail, bookmarksView, saveBookmarkView } from "../src/bookmark-views";
import { captureBookmark, parseBookmark, type Bookmark } from "../src/bookmarks";
import type { JumperContext } from "../src/types";

const location = { bookId: "book-a", contentVersion: "source-v1", cfi: "epubcfi(/6/2)", href: "chapter-1", fraction: 0.2 };
const sample: Bookmark = { version: 1, name: "A passage", bookTitle: "Book A", kind: "location", target: location };
function fixture() {
  const documents = new Map<string, PluginDocument>();
  let revision = 0, generation = 0, missing = false, failWrite = false;
  const writes: PluginDocumentChange[][] = [], moves: unknown[] = [], pages: unknown[] = [];
  const session = { status: "ready", sessionId: "session-a", bookId: "book-a", location: structuredClone(location), selection: null,
    history: { canGoBack: false, canGoForward: false },
  } as ReadingSessionSnapshot;
  const collection = {
    get: async (id: string) => structuredClone(documents.get(id) ?? null),
    page: async (query: { bookId?: string; limit: number; cursor?: string }) => {
      pages.push(query);
      const [version, offset] = query.cursor?.split(":").map(Number) ?? [generation, 0];
      if (version !== generation) return { status: "stale-cursor" };
      const filtered = [...documents.values()].filter(doc => !query.bookId || doc.bookId === query.bookId);
      return { status: "ready", items: structuredClone(filtered.slice(offset, offset + query.limit)),
        nextCursor: offset + query.limit < filtered.length ? `${generation}:${offset + query.limit}` : null };
    },
  };
  const ctx = { locale: "en", domains: {
    reading: { queries: { session: async () => session }, commands: { goTo: async (target: unknown) => { moves.push(target); return { status: "completed" }; } },
      events: { observeSession: () => ({ dispose() {} }) } },
    library: { queries: { books: { get: async (id: string) => missing ? null : { id, title: id === "book-a" ? "Book A" : "Book B" } } } },
  }, services: { storage: {
    collection: (name: string) => { expect(name).toBe("bookmarks"); return collection; },
    applyDocuments: async (changes: PluginDocumentChange[]) => {
      if (failWrite) throw Object.assign(Error("private sqlite details"), { code: "db/locked" });
      writes.push(structuredClone(changes));
      const conflict = changes.findIndex(change => (documents.get(change.id)?.revision ?? null) !== change.expectedRevision);
      if (conflict >= 0) return { status: "conflict", index: conflict };
      for (const change of changes) {
        if (change.kind === "delete") documents.delete(change.id);
        if (change.kind === "put") documents.set(change.id, { id: change.id, data: structuredClone(change.data), bookId: change.bookId,
          anchor: change.anchor, revision: `r${++revision}`, updatedAt: "2026-09-11T00:00:00.000Z" });
      }
      generation++;
      return { status: "applied", documents: changes.map(change => ({ collection: change.collection, id: change.id, revision: documents.get(change.id)?.revision ?? null })) };
    },
  } } } as unknown as JumperContext;
  const seed = (id: string, data: unknown = sample) => { documents.set(id, { id, data: structuredClone(data), bookId: "book-a", revision: `r${++revision}`, updatedAt: "2026-09-11T00:00:00.000Z" }); generation++; };
  return { ctx, documents, writes, moves, pages, session, seed, missing: () => { missing = true; }, fail: () => { failWrite = true; } };
}
const view = (result: PluginViewResult) => result!.view!;
async function action(value: PluginListView | PluginDetailView, id: string) { return (await value.actions!.find(item => item.id === id)!.run())!; }
function form(value: PluginView): PluginFormView {
  if (value.kind === "form") return value;
  if (value.kind === "blocks") return value.blocks.find(block => block.kind === "form") as PluginFormView;
  throw Error("Expected form");
}

test("save captures and names the original location, not the reader at submit time", async () => {
  const f = fixture(), save = form(await saveBookmarkView(f.ctx, "location"));
  expect(f.documents.size).toBe(0);
  f.session.bookId = "book-b"; f.session.location!.bookId = "book-b";
  expect(await save.onSubmit({ name: " " })).toHaveProperty("fieldErrors.name");
  expect(await save.onSubmit({ name: "x".repeat(121) })).toHaveProperty("fieldErrors.name");
  const result = await save.onSubmit({ name: "  Chapter opening  " });
  expect(JSON.stringify(result)).toContain("Bookmark saved");
  expect(f.writes[0]).toEqual([expect.objectContaining({ collection: "bookmarks", kind: "put", expectedRevision: null,
    bookId: "book-a", anchor: location.cfi, data: { version: 1, name: "Chapter opening", bookTitle: "Book A", kind: "location",
      target: { bookId: "book-a", contentVersion: "source-v1", cfi: location.cfi } } })]);
  await save.onSubmit({ name: "Second submit" });
  expect(f.documents.size).toBe(1);
  expect([...f.documents.values()][0]!.data).toHaveProperty("name", "Chapter opening");
});

test("selection bookmark retains its versioned range and exact PDF disambiguating quote", async () => {
  const f = fixture();
  f.session.selection = { id: "selection", text: "Selected text", textLength: 13,
    range: { bookId: "book-a", contentVersion: "source-v1", cfi: "epubcfi(/6/4)", textQuote: { exact: "Selected text", prefix: "Before", suffix: "After" } } };
  const captured = await captureBookmark(f.ctx, "selection");
  expect(captured.name).toBe("Selected text");
  expect(captured.target).toEqual(f.session.selection.range!);
  f.session.selection.range!.textQuote!.exact = "Changed selection";
  expect(captured.target.textQuote!.exact).toBe("Selected text");
  f.session.selection.range!.bookId = "book-b";
  await expect(captureBookmark(f.ctx, "selection")).rejects.toMatchObject({ code: "reader/stale-location" });
  f.session.selection.range = null;
  await expect(captureBookmark(f.ctx, "selection")).rejects.toMatchObject({ code: "reader/stale-location" });
});

test("missing books and unavailable readers cannot create misleading bookmarks", async () => {
  const f = fixture(); f.missing();
  await expect(captureBookmark(f.ctx, "location")).rejects.toMatchObject({ code: "library/book-not-found" });
  f.session.status = "loading";
  await expect(captureBookmark(f.ctx, "location")).rejects.toMatchObject({ code: "reader/unavailable" });
  expect(f.writes).toHaveLength(0);
});

test("fresh view instances return across books with the stored version and close only after navigation", async () => {
  const f = fixture(); f.seed("saved");
  f.session.bookId = "book-b";
  const list = await bookmarksView(f.ctx) as PluginListView;
  const detail = view(await list.items[0]!.onSelect!()) as PluginDetailView;
  let complete!: () => void;
  f.ctx.domains.reading.commands.goTo = async target => { f.moves.push(target); await new Promise<void>(resolve => { complete = resolve; }); return { status: "completed", sessionId: "returned", location }; };
  let finished = false;
  const pending = action(detail, "open").then(result => { finished = true; return result; });
  await Promise.resolve(); await Promise.resolve();
  expect(finished).toBe(false); complete();
  expect(await pending).toEqual({ close: true });
  expect(f.moves).toEqual([{ bookId: "book-a", contentVersion: "source-v1", cfi: location.cfi }]);
});

test("navigation rejects a removed book or stale content without fallback, mutation or false close", async () => {
  const f = fixture(); f.seed("saved"); const detail = await bookmarkDetail(f.ctx, "saved");
  f.ctx.domains.reading.commands.goTo = async target => { f.moves.push(target); throw Object.assign(Error("changed"), { code: "reader/stale-location" }); };
  await expect(action(detail, "open")).rejects.toMatchObject({ code: "reader/stale-location" });
  expect(f.moves).toHaveLength(1); expect(f.writes).toHaveLength(0);
  f.missing(); await expect(action(detail, "open")).rejects.toMatchObject({ code: "library/book-not-found" });
  expect(f.moves).toHaveLength(1); expect(f.documents.has("saved")).toBe(true);
});

test("rename and confirmed deletion compare the displayed revision, not a freshly fetched write", async () => {
  const f = fixture(); f.seed("saved"); const detail = await bookmarkDetail(f.ctx, "saved");
  const rename = form(view(await action(detail, "rename"))), remove = form(view(await action(detail, "remove")));
  expect(await remove.onSubmit({ confirm: false })).toHaveProperty("fieldErrors.confirm");
  const receipt = await rename.onSubmit({ name: "Renamed" });
  expect(JSON.stringify(receipt)).toContain("Bookmark renamed");
  expect(JSON.stringify(await remove.onSubmit({ confirm: true }))).toContain("This bookmark changed");
  expect(f.documents.get("saved")!.data).toHaveProperty("name", "Renamed");
  const fresh = await bookmarkDetail(f.ctx, "saved");
  const confirm = form(view(await action(fresh, "remove")));
  expect(JSON.stringify(await confirm.onSubmit({ confirm: true }))).toContain("Bookmark deleted");
  expect(f.documents.has("saved")).toBe(false);
  expect(f.moves).toHaveLength(0);
});

test("bounded pages keep exact cursors and a collection write invalidates continuation", async () => {
  const f = fixture(); for (let i = 0; i < 43; i++) f.seed(String(i));
  const first = await bookmarksView(f.ctx, "book-a") as PluginListView;
  expect(first.items).toHaveLength(40);
  const second = view(await first.pagination!.onNext!()) as PluginListView;
  expect(second.items).toHaveLength(3);
  expect(f.pages[1]).toEqual({ bookId: "book-a", limit: 40, cursor: "43:40" });
  f.seed("new");
  const stale = view(await first.pagination!.onNext!()) as PluginDetailView;
  expect(JSON.stringify(stale)).toContain("Bookmarks changed");
  const refreshed = view(await action(stale, "refresh")) as PluginListView;
  expect(refreshed.pagination!.page).toBe(1);
});

test("malformed and missing documents are explicit, and invalid data remains removable", async () => {
  const f = fixture(); f.seed("bad", { version: 2, name: "corrupt" });
  expect(parseBookmark({ ...sample, target: { ...location, textQuote: { exact: "x".repeat(12001) } } })).toBeNull();
  expect(parseBookmark({ ...sample, target: { bookId: "book-a", contentVersion: "v", fraction: Infinity } })).toBeNull();
  expect(parseBookmark({ ...sample, target: { ...location, cfi: "" } })).toBeNull();
  const invalid = await bookmarkDetail(f.ctx, "bad");
  expect(invalid.actions!.map(a => a.id)).toEqual(["remove", "refresh"]);
  await form(view(await action(invalid, "remove"))).onSubmit({ confirm: true });
  expect(f.documents.size).toBe(0);
  expect(JSON.stringify(await bookmarkDetail(f.ctx, "missing"))).toContain("Bookmark no longer exists");
});

test("write failure is not a saved result and does not close or drop the naming form", async () => {
  const f = fixture(), save = form(await saveBookmarkView(f.ctx, "location")); f.fail();
  await expect(save.onSubmit({ name: "A bookmark" })).rejects.toMatchObject({ code: "db/locked" });
  expect(f.documents.size).toBe(0); expect(f.writes).toHaveLength(0);
});

test("compiled bookmark command works without an open reader, while the reader menu exposes the same list", async () => {
  const f = fixture(); f.seed("saved");
  const commands = new Map<string, () => Promise<PluginViewResult>>();
  const registration = { dispose() {}, updateState: async () => ({ status: "applied" }) };
  Object.assign(f.ctx, { contributions: {
    commands: { register: (command: { id: string; run: () => Promise<PluginViewResult> }) => { commands.set(command.id, command.run); return registration; } },
    headerActions: { register: () => registration },
    agentTools: { register: () => registration },
  } });
  const plugin = (await import(new URL("../dist/main.js", import.meta.url).href)).default as PluginModule;
  await plugin.activate(f.ctx);
  f.session.status = "idle"; f.session.bookId = null; f.session.location = null;
  const list = view(await commands.get("bookmarks")!()) as PluginListView;
  expect(list.items.map(item => item.id)).toEqual(["saved"]);
  expect(list.actions!.map(item => item.id)).toEqual(["refresh"]);
  f.session.status = "ready"; f.session.bookId = "book-a"; f.session.location = location;
  const root = view(await commands.get("open")!());
  if (root.kind !== "blocks") throw Error("Expected Jumper root");
  const menu = root.blocks.find(block => block.kind === "actions" && block.actions.some(a => a.id === "bookmarks"));
  if (menu?.kind !== "actions") throw Error("Expected bookmark action");
  expect((view(await menu.actions.find(a => a.id === "bookmarks")!.run()) as PluginListView).items).toHaveLength(1);
  const manifest = await Bun.file(new URL("../dist/manifest.json", import.meta.url)).json();
  expect(manifest.requires.services.storage).toBe("^2.1.0");
  expect(manifest.permissions).toEqual(["library:read", "reading:write", "agent:tools"]);
});
