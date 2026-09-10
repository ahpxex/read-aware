import { expect, test } from "bun:test";
import type { PluginFormView, PluginModule, PluginSelectionAction, PluginView, PluginViewResult, SelectionActionInput } from "@read-aware/plugin-types";
import { newNoteView, selectionCreationView } from "../src/creation";
import { deskView } from "../src/views";
import type { DeskContext } from "../src/types";
import { tr } from "../src/strings";

const input: SelectionActionInput = { book: { id: "book", title: "Book" }, text: "Exact selected text",
  cfiRange: "captured-cfi", chapterHref: "chapter.xhtml", source: "selection" };
type Commands = DeskContext["domains"]["annotations"]["commands"];
function fixture() {
  const notes: Parameters<Commands["createNote"]>[0][] = [], highlights: Parameters<Commands["createHighlight"]>[0][] = [];
  const ctx = { locale: "en", domains: {
    annotations: { queries: { page: async () => ({ items: [], nextCursor: null }), inspect: async () => { throw Error("Read failed"); } }, commands: {
      createNote: async (data: Parameters<Commands["createNote"]>[0]) => { notes.push(data); return { ...data, id: "created-note", kind: "note" }; },
      createHighlight: async (data: Parameters<Commands["createHighlight"]>[0]) => { highlights.push(data); return { ...data, id: "created-highlight", kind: "highlight" }; },
    } }, library: { queries: { books: { list: async () => [{ id: "book", title: "Book" }, { id: "second", title: "Second" }],
      get: async (id: string) => id === "book" ? { id, title: "Book" } : null } } },
    reading: { queries: { session: async () => ({ bookId: "book" }) }, commands: {} },
  }, services: { ui: {} } } as unknown as DeskContext;
  const refresh = async () => ({ view: await deskView(ctx), navigation: "reset" as const });
  return { ctx, notes, highlights, refresh };
}
function form(view: PluginView): PluginFormView {
  if (view.kind === "form") return view;
  const candidate = view.kind === "detail" ? view.content.find(block => block.kind === "form") : null;
  if (candidate?.kind !== "form") throw Error("Expected form");
  return candidate;
}
function view(result: PluginViewResult): PluginView {
  if (!result?.view) throw Error("Expected view");
  return result.view;
}

test("standalone note creation chooses from the captured books and keeps text intact", async () => {
  const f = fixture(), create = form(await newNoteView(f.ctx, f.refresh));
  expect(await create.onSubmit({ bookId: "missing", body: "Note" })).toHaveProperty("fieldErrors.bookId");
  expect(await create.onSubmit({ bookId: "book", body: "  " })).toHaveProperty("fieldErrors.body");
  expect(await create.onSubmit({ bookId: "book", body: "x".repeat(100_001) })).toHaveProperty("fieldErrors.body");
  expect(f.notes).toEqual([]);
  const saved = await create.onSubmit({ bookId: "second", body: "  Keep formatting\n" });
  expect(saved).toHaveProperty("navigation", "replace");
  expect(view(saved).title).toBe("Annotation saved");
  expect(f.notes).toEqual([{ bookId: "second", body: "  Keep formatting\n" }]);
});

test("book-scoped creation freezes the book choice and missing books offer no write form", async () => {
  const f = fixture(), create = form(await newNoteView(f.ctx, f.refresh, "book"));
  expect(create.fields[0]).toMatchObject({ kind: "select", value: "book" });
  expect(await create.onSubmit({ bookId: "second", body: "Wrong book" })).toHaveProperty("fieldErrors.bookId");
  const missing = await newNoteView(f.ctx, f.refresh, "missing");
  expect(missing).toMatchObject({ kind: "list", items: [] });
  f.ctx.domains.library.queries.books.list = async () => { throw Error("Locked"); };
  await expect(newNoteView(f.ctx, f.refresh)).rejects.toThrow("Locked");
});

test("selection note freezes book/text/anchor without reading a newer selection or inventing a range version", async () => {
  const f = fixture(), selected = structuredClone(input);
  const create = form(selectionCreationView(f.ctx, selected, "note", f.refresh));
  selected.book.id = "second"; selected.text = "New text"; selected.cfiRange = "new-cfi";
  await create.onSubmit({ body: "A note" });
  expect(f.notes).toEqual([{ bookId: "book", anchor: "captured-cfi", chapterHref: "chapter.xhtml", quotedText: "Exact selected text", body: "A note" }]);
});

test("highlight creation validates both options and supports every existing color and style", async () => {
  const f = fixture(), create = form(selectionCreationView(f.ctx, input, "highlight", f.refresh));
  expect(await create.onSubmit({ color: "invalid", style: "highlight" })).toHaveProperty("fieldErrors.color");
  expect(await create.onSubmit({ color: "blue", style: "invalid" })).toHaveProperty("fieldErrors.style");
  for (const color of ["yellow", "green", "blue", "pink"] as const) for (const style of ["highlight", "underline"] as const) {
    await create.onSubmit({ color, style });
    expect(f.highlights[f.highlights.length - 1]).toEqual({ bookId: "book", text: input.text, anchor: input.cfiRange, chapterHref: input.chapterHref, color, style });
  }
  expect(f.highlights).toHaveLength(8);
});

test("empty/oversize selection has no create action; missing anchors remain explicit and null", async () => {
  const f = fixture();
  for (const text of [" ", "x".repeat(100_001)]) expect(selectionCreationView(f.ctx, { ...input, text }, "note", f.refresh).kind).toBe("blocks");
  const unanchored = selectionCreationView(f.ctx, { ...input, cfiRange: null, chapterHref: null }, "note", f.refresh);
  expect(unanchored).toHaveProperty("content.1.text", "No exact text anchor is available.");
  await form(unanchored).onSubmit({ body: "Quoted note" });
  expect(f.notes[0]).toMatchObject({ anchor: null, chapterHref: null, quotedText: input.text });
});

test("create failures preserve the form; receipt needs no reread and later inspection cannot repeat the write", async () => {
  const f = fixture(), create = form(selectionCreationView(f.ctx, input, "note", f.refresh));
  const receipt = view(await create.onSubmit({ body: "Saved once" }));
  if (receipt.kind !== "detail") throw Error("Expected receipt");
  await expect(receipt.actions!.find(action => action.id === "inspect-created")!.run()).rejects.toThrow("Read failed");
  expect(f.notes).toHaveLength(1);
  const refreshResult = await receipt.actions!.find(action => action.id === "annotations")!.run();
  expect(view(refreshResult).kind).toBe("list");
  f.ctx.domains.annotations.commands.createNote = async () => { throw Error("Write failed"); };
  await expect(create.onSubmit({ body: "Retain draft" })).rejects.toThrow("Write failed");
});

test("compiled plugin exposes both selection actions and the desk create flow with existing permissions", async () => {
  const f = fixture(), selections: PluginSelectionAction[] = [];
  f.ctx.contributions = {
    selectionActions: { register: (action: PluginSelectionAction) => { selections.push(action); return { dispose() {} }; } },
    headerActions: { register: () => ({ dispose() {} }) }, commands: { register: () => ({ dispose() {} }) },
  } as unknown as DeskContext["contributions"];
  const plugin = (await import(new URL("../dist/main.js", import.meta.url).href)).default as PluginModule;
  await plugin.activate(f.ctx);
  expect(selections.map(action => [action.id, action.presentation])).toEqual([["create-note", "dialog"], ["create-highlight", "dialog"]]);
  const captured = view(await selections[0].run(input));
  await form(captured).onSubmit({ body: "Compiled note" });
  await form(view(await selections[1].run(input))).onSubmit({ color: "green", style: "underline" });
  const root = await deskView(f.ctx);
  if (root.kind !== "list") throw Error("Expected list");
  expect(view(await root.actions!.find(action => action.id === "new-note")!.run()).kind).toBe("form");
  expect(f.notes).toHaveLength(1); expect(f.highlights).toHaveLength(1);
  const manifest = await Bun.file(new URL("../dist/manifest.json", import.meta.url)).json();
  expect(manifest.version).toBe("0.4.0");
  expect(manifest.permissions).toEqual(["annotations:write", "library:read", "reading:write"]);
  expect(manifest.requires.contributions.selectionActions).toBe("^1.2.0");
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"]) {
    for (const key of ["newNote", "newHighlight", "created", "viewCreated", "chooseBook", "bodyRequired", "selectionLimit", "unanchored"] as const) expect(tr(locale, key).length).toBeGreaterThan(0);
  }
});
