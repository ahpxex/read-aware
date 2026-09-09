import { describe, expect, test } from "bun:test";
import type { BookGraphResult, PluginContext, PluginDetailView, PluginFormView, PluginListView } from "@read-aware/plugin-types";
import { graphSearch, graphView } from "../src/graph";
import { booksView, memories, memoryDesk } from "../src/views";
import { strings } from "../src/strings";

function fixture() {
  let graph: BookGraphResult = { graph: "chapter", chapterIndex: 0, chapterHref: "one.xhtml", summary: "Ada meets Ben", entities: [], relations: [] };
  const calls: unknown[] = [];
  const ctx = { locale: "en", domains: {
    library: { queries: { books: { list: async () => Array.from({ length: 41 }, (_, index) => ({ id: `b${index}`, title: `Book ${index}` })) } } },
    memory: { queries: { search: async (query: unknown) => { calls.push(query); return []; }, bookGraph: async (id: string, query: unknown) => { calls.push({ id, query }); return graph; } } },
    reading: { commands: { goTo: async (target: unknown) => { calls.push(target); } } },
  } } as unknown as PluginContext;
  return { ctx, calls, setGraph: (value: BookGraphResult) => { graph = value; } };
}
describe("Memory Desk public composition", () => {
  test("home and scoped memory queries stay within explicit scopes", async () => {
    const { ctx, calls } = fixture();
    expect((await memoryDesk(ctx)).items.map(item => item.id)).toEqual(["user", "global", "books"]);
    await memories(ctx, "book:b", "Ada"); expect(calls).toEqual([{ scopes: ["book:b"], query: "Ada", limit: 100 }]);
  });
  test("book pagination clamps after library shrink", async () => {
    const { ctx } = fixture();
    expect((await booksView(ctx)).items).toHaveLength(40);
    const last = await booksView(ctx, 99); expect(last.items).toHaveLength(1); expect(last.items[0]!.id).toBe("b40");
    expect(last.actions?.some(action => action.id === "previous")).toBe(true);
    expect(last.actions?.some(action => action.id === "next")).toBe(false);
  });
  test("form converts displayed chapter numbers, rejecting ambiguous modes", async () => {
    const { ctx, calls } = fixture(), form = graphSearch(ctx, "b");
    expect(await form.onSubmit({ chapter: "0", names: "" })).toHaveProperty("fieldErrors");
    expect(await form.onSubmit({ chapter: "2", names: "Ada" })).toHaveProperty("fieldErrors");
    expect(await form.onSubmit({ chapter: "", names: Array(9).fill("Ada").join("\n") })).toHaveProperty("fieldErrors");
    await form.onSubmit({ chapter: "2", names: "" }); expect(calls).toContainEqual({ id: "b", query: { chapterIndex: 1 } });
  });
  test("source action rechecks visibility and waits for guarded navigation", async () => {
    const f = fixture(), view = await graphView(f.ctx, "b", { chapterIndex: 0 }) as PluginDetailView;
    const action = view.actions!.find(action => action.id === "source")!;
    f.setGraph({ graph: "miss", note: "withheld" });
    expect(await action.run()).toHaveProperty("navigation", "replace"); expect(f.calls.some(value => (value as { href?: string }).href)).toBe(false);
    f.setGraph({ graph: "chapter", chapterIndex: 0, chapterHref: "one.xhtml", summary: "Visible", entities: [], relations: [] });
    expect(await action.run()).toEqual({ close: true }); expect(f.calls).toContainEqual({ bookId: "b", href: "one.xhtml" });
  });
  test("missing provenance and failed reads are not fake successful navigation or empty lists", async () => {
    const f = fixture();
    f.setGraph({ graph: "chapter", chapterIndex: 0, summary: "Legacy", entities: [], relations: [] });
    const view = await graphView(f.ctx, "b") as PluginDetailView;
    expect(await view.actions!.find(action => action.id === "source")!.run()).toHaveProperty("view");
    f.ctx.domains.memory!.queries.search = async () => { throw Error("read refused"); };
    await expect(memories(f.ctx, "user")).rejects.toThrow("read refused");
  });
  test("profiles preserve provenance chapter actions and bounded-result notices", async () => {
    const f = fixture(); f.setGraph({ graph: "profiles", profiles: [{ name: "Ada", appearsInChapters: [2], relations: [], relationsTruncated: true }], notFound: ["Ben"], truncated: true, note: "" });
    const view = await graphView(f.ctx, "b") as PluginDetailView;
    expect(view.content.some(block => block.kind === "text" && block.text.includes("Results limited"))).toBe(true);
    const list = view.content[0] as PluginListView;
    const detail = (await list.items[0]!.onSelect!())!.view as PluginDetailView;
    const chapters = detail.content.find(block => block.kind === "list") as PluginListView;
    await chapters.items[0]!.onSelect!(); expect(f.calls).toContainEqual({ id: "b", query: { chapterIndex: 2 } });
  });
  test("memory search validates before making a host request", async () => {
    const f = fixture(), view = await memories(f.ctx, "global");
    const form = (await view.actions!.find(action => action.id === "search")!.run())!.view as PluginFormView;
    expect(await form.onSubmit({ query: "a".repeat(2001) })).toHaveProperty("fieldErrors");
    expect(f.calls).toHaveLength(1);
  });
  test("a bounded overview reports omitted entities without losing search", async () => {
    const f = fixture(); f.setGraph({ graph: "overview", chaptersDigested: 1, chapterRange: [0, 0], entityCount: 201, edgeCount: 0,
      entities: [{ name: "Ada", chapters: 1 }], truncated: true, note: "" });
    const view = await graphView(f.ctx, "b") as PluginDetailView;
    expect(view.content[0]).toEqual({ kind: "text", text: "Results limited" });
    expect(view.actions!.some(action => action.id === "search")).toBe(true);
    const list = view.content[1] as PluginListView;
    await list.items[0]!.onSelect!(); expect(f.calls).toContainEqual({ id: "b", query: { names: ["Ada"] } });
  });
  test("all supported locales have the full vocabulary", () => {
    for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) {
      expect(strings(locale)).toHaveLength(24); expect(strings(locale).every(text => text.length > 0)).toBe(true);
    }
  });
});
