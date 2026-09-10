import { expect, test } from "bun:test";
import type { PluginBook, PluginContext, PluginDetailView, PluginFormView, PluginLibraryDomain, PluginListView, PluginModule, PluginView } from "@read-aware/plugin-types";
import { organizeBook } from "../src/organize-books";
import { collectionList, moveBooks } from "../src/collections";
import { duplicateList, duplicateReview } from "../src/duplicates";

type Preview = NonNullable<Awaited<ReturnType<PluginLibraryDomain["queries"]["books"]["previewMerge"]>>>;
function fixture() {
  const book: PluginBook = { id: "a", title: "Alpha", author: "Author", format: "epub", collectionId: null, starred: false, addedAt: "2026-09-11", updatedAt: "2026-09-11" };
  let collections = [{ id: "collection", name: "Collection", createdAt: "2026-09-11" }];
  const preview: Preview = { revision: `bmg1:${"a".repeat(64)}`, keep: { id: "a", title: "Alpha", author: "Author", createdAt: "2026-09-11" },
    merged: Array.from({ length: 21 }, (_, index) => ({ id: `duplicate-${index}`, title: `Duplicate ${index}`, author: "Other", createdAt: "2026-09-11" })) };
  const calls: unknown[][] = [], updates: PluginListView[] = [];
  const queries = {
    list: async () => [{ ...book }], get: async (id: string) => { calls.push(["get", id]); return id === "a" ? { ...book } : null; },
    listDuplicates: async (input: { offset?: number; limit?: number }) => { calls.push(["duplicates", input]); return { groups: [{ bookId: "a", title: "Alpha", count: 22 }], total: 21, nextOffset: input.offset ? null : 20 }; },
    previewMerge: async (id: string) => { calls.push(["preview", id]); return preview; },
    resolveId: async (id: string) => { calls.push(["resolve", id]); return "a"; },
  };
  const write = {
    editMetadata: async (id: string, patch: { title?: string; author?: string }) => { calls.push(["metadata", id, patch]); Object.assign(book, patch); },
    setStarred: async (id: string, starred: boolean) => { calls.push(["star", id, starred]); book.starred = starred; },
    mergeDuplicates: async (input: { bookId: string; expectedRevision: string }) => { calls.push(["merge", input]); return { committed: true, keepId: "a", redirects: preview.merged.map(member => ({ from: member.id, to: "a" })) }; },
  };
  const collectionWrites = {
    create: async (name: string) => { calls.push(["create", name]); return { id: "new", name, createdAt: "2026-09-11" }; },
    rename: async (id: string, name: string) => { calls.push(["rename", id, name]); },
    remove: async (id: string) => { calls.push(["remove", id]); },
    assignBooks: async (ids: string[], target: string | null) => { calls.push(["assign", ids, target]); },
  };
  const ctx = { locale: "en", domains: { library: { queries: { books: queries, collections: {
    list: async () => collections, booksIn: async (id: string) => { calls.push(["members", id]); return ["a"]; },
  } }, commands: { books: write, collections: collectionWrites } } }, services: { ui: {
    publishView: async (_channel: unknown, update: { view: PluginListView }) => { updates.push(update.view); return { status: "applied" }; },
  } } } as unknown as PluginContext;
  return { ctx, book, preview, queries, write, collectionWrites, calls, updates, setCollections(next: typeof collections) { collections = next; } };
}
const action = (view: PluginView, id: string) => (view as PluginDetailView).actions!.find(item => item.id === id)!;

test("metadata submits only changed fields, permits an explicit author clear and rejects an empty title", async () => {
  const f = fixture(), view = await organizeBook(f.ctx, "a"), form = (await action(view, "metadata").run())!.view as PluginFormView;
  expect(await form.onSubmit({ title: " ", author: "" })).toHaveProperty("fieldErrors.title");
  expect(f.calls).toEqual([["get", "a"]]);
  const result = await form.onSubmit({ title: " Alpha ", author: "" });
  expect(f.calls[1]).toEqual(["metadata", "a", { author: "" }]);
  expect(result!.navigation).toBe("replace");
  const current = (await action(result!.view!, "refresh").run())!.view as PluginDetailView;
  expect(current.content[0]).toMatchObject({ rows: [{ label: "Author", value: "" }, { label: "Favorite", value: "No" }] });
});

test("favorite is a separate single write, then refresh reads the new state; missing book offers no writes", async () => {
  const f = fixture(), view = await organizeBook(f.ctx, "a");
  const done = await action(view, "favorite").run();
  expect(f.calls).toEqual([["get", "a"], ["star", "a", true]]);
  const current = (await action(done!.view!, "refresh").run())!.view!;
  expect(action(current, "favorite").label).toBe("Remove from favorites");
  const missing = await organizeBook(f.ctx, "gone");
  expect(missing.actions).toBeUndefined();
  f.write.setStarred = async () => { throw Error("write failed"); };
  await expect(action(current, "favorite").run()).rejects.toThrow("write failed");
});

test("collections compose validated create/rename and separately confirmed removal without deleting books", async () => {
  const f = fixture(), list = await collectionList(f.ctx);
  const create = (await action(list, "create").run())!.view as PluginFormView;
  expect(await create.onSubmit({ name: " " })).toHaveProperty("fieldErrors.name");
  await create.onSubmit({ name: " New collection " });
  const detail = (await list.items[0].onSelect!())!.view!;
  const rename = (await action(detail, "rename").run())!.view as PluginFormView;
  await rename.onSubmit({ name: "Renamed" });
  const remove = (await action(detail, "remove").run())!.view as PluginFormView;
  expect(await remove.onSubmit({ confirm: false })).toHaveProperty("fieldErrors.confirm");
  expect(f.calls.some(call => call[0] === "remove")).toBe(false);
  await remove.onSubmit({ confirm: true });
  expect(f.calls).toEqual([["create", "New collection"], ["members", "collection"], ["rename", "collection", "Renamed"], ["remove", "collection"]]);
});

test("move review pages frozen book identities and rejects missing destination or unchecked confirmation", async () => {
  const f = fixture(), selected = Array.from({ length: 21 }, (_, index) => ({ ...f.book, id: String(index), title: `Title ${index}` }));
  const review = await moveBooks(f.ctx, selected), list = review.content[0] as PluginListView;
  const next = (await list.pagination!.onNext!())!.view as PluginDetailView;
  expect((next.content[0] as PluginListView).items).toHaveLength(1);
  selected[0].id = "changed";
  const form = next.content[1] as PluginFormView;
  expect(await form.onSubmit({ destination: "1", confirm: false })).toHaveProperty("fieldErrors.confirm");
  expect(await form.onSubmit({ destination: "", confirm: true })).toHaveProperty("fieldErrors.destination");
  expect(await form.onSubmit({ destination: "unknown", confirm: true })).toHaveProperty("fieldErrors.destination");
  await form.onSubmit({ destination: "1", confirm: true });
  expect(f.calls).toEqual([["assign", Array.from({ length: 21 }, (_, index) => String(index)), "collection"]]);
  f.setCollections([]);
  expect(await form.onSubmit({ destination: "1", confirm: true })).toHaveProperty("fieldErrors.destination");
  await form.onSubmit({ destination: "0", confirm: true });
  expect(f.calls[1][2]).toBeNull();
});

test("duplicate review freezes the entire group revision through pagination and requires explicit merge confirmation", async () => {
  const f = fixture(), list = await duplicateList(f.ctx), review = (await list.items[0].onSelect!())!.view as PluginDetailView;
  const expectedRevision = f.preview.revision;
  f.preview.revision = `bmg1:${"b".repeat(64)}`;
  f.preview.keep.id = "changed";
  const next = (await (review.content[1] as PluginListView).pagination!.onNext!())!.view as PluginDetailView;
  expect((next.content[1] as PluginListView).items[0].id).toBe("duplicate-20");
  const form = (await action(next, "merge").run())!.view as PluginFormView;
  expect(await form.onSubmit({ confirm: false })).toHaveProperty("fieldErrors.confirm");
  expect(f.calls.some(call => call[0] === "merge")).toBe(false);
  const result = await form.onSubmit({ confirm: true });
  expect(f.calls[f.calls.length - 1]).toEqual(["merge", { bookId: "a", expectedRevision }]);
  expect(result!.navigation).toBe("reset");
  const receipt = result!.view as PluginListView;
  expect(receipt.items).toHaveLength(20);
  const receiptNext = (await receipt.pagination!.onNext!())!.view as PluginListView;
  expect(receiptNext.items[0]).toMatchObject({ id: "duplicate-20", subtitle: "a" });
  await action(receiptNext, "keeper").run();
  expect(f.calls.slice(-2)).toEqual([["resolve", "a"], ["get", "a"]]);
});

test("stale merge is an error, not an automatic refresh/retry against a different group", async () => {
  const f = fixture(), review = await duplicateReview(f.ctx, "a"), form = (await action(review, "merge").run())!.view as PluginFormView;
  const error = Object.assign(Error("private details"), { code: "ui/superseded" });
  f.write.mergeDuplicates = async input => { f.calls.push(["merge", input]); throw error; };
  await expect(form.onSubmit({ confirm: true })).rejects.toBe(error);
  expect(f.calls.filter(call => call[0] === "preview")).toHaveLength(1);
  expect(f.calls.filter(call => call[0] === "merge")).toHaveLength(1);
  await action(review, "refresh").run();
  expect(f.calls.filter(call => call[0] === "preview")).toHaveLength(2);
});

test("compiled entry routes to duplicates, collection management and single-book organization", async () => {
  const f = fixture(), plugin = (await import(new URL("../dist/main.js", import.meta.url).href)).default as PluginModule;
  let header: Parameters<PluginContext["contributions"]["headerActions"]["register"]>[0] | undefined;
  f.ctx.contributions = { commands: { register() {} }, headerActions: { register(value: typeof header) { header = value; } } } as unknown as PluginContext["contributions"];
  await plugin.activate(f.ctx);
  const root = await header!.view({}) as PluginView & PluginListView, subscription = await root.live!.subscribe({ id: "compiled" });
  expect((await action(root, "duplicates").run())!.view!.title).toBe("Duplicate books");
  expect((await action(root, "collections").run())!.view!.title).toBe("Collections");
  await f.updates[f.updates.length - 1].items[0].onSelect!();
  const selected = f.updates[f.updates.length - 1];
  expect((await action(selected, "organize").run())!.view!.title).toBe("Alpha");
  expect((await action(selected, "move").run())!.view!.kind).toBe("detail");
  subscription.dispose();
});
