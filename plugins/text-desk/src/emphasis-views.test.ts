import { expect, test } from "bun:test";
import type { PluginContext, PluginDetailView, PluginListView, ReadingEmphasisSnapshot } from "@read-aware/plugin-types";
import { markPassages, emphasisList } from "./emphasis-views";

test("temporary marks compose guarded create/replace/remove without an annotation write", async () => {
  const range = { bookId: "book", contentVersion: "v1", cfi: "epubcfi(/6/2)" }, calls: unknown[] = [];
  let revision = 0, values: ReadingEmphasisSnapshot[] = [];
  const ctx = { locale: "en", domains: { reading: {
    queries: { session: async () => ({ bookId: "book", sessionId: "session", status: "ready" }), emphasis: async () => values },
    commands: {
      putEmphasis: async (input: unknown, guard: unknown) => {
        calls.push(["put", input, guard]); const mark: ReadingEmphasisSnapshot = { id: "mark", revision: ++revision, bookId: "book", sessionId: "session", count: 1, attached: 1, status: "attached", style: "highlight" };
        values = [mark]; return { status: "completed", emphasis: mark };
      },
      removeEmphasis: async (input: unknown, guard: unknown) => { calls.push(["remove", input, guard]); values = []; return { status: "completed", id: "mark", removed: true }; },
    },
  } } } as unknown as PluginContext;
  const result = await markPassages(ctx, [range]);
  const detail = result.view as PluginDetailView;
  expect(calls[0]).toEqual(["put", { ranges: [range] }, { bookId: "book", sessionId: "session" }]);
  const next = await detail.actions!.find(a => a.id === "style")!.run();
  expect(calls[1]).toEqual(["put", { ranges: [range], id: "mark", expectedRevision: 1, style: "underline" }, { bookId: "book", sessionId: "session" }]);
  await (next!.view as PluginDetailView).actions!.find(a => a.id === "remove-mark")!.run();
  expect(calls[2]).toEqual(["remove", { id: "mark", expectedRevision: 2 }, { bookId: "book", sessionId: "session" }]);
  expect((await emphasisList(ctx)).items).toEqual([]);
});

test("live mark lists publish attachment changes and release their observer", async () => {
  let observe!: (values: ReadingEmphasisSnapshot[]) => Promise<void>, stopped = false;
  const published: Array<{ revision: number; view: PluginListView }> = [];
  const ctx = { locale: "en", domains: { reading: { queries: { emphasis: async () => [] }, events: {
    observeEmphasis: (handler: typeof observe) => { observe = handler; return { dispose: () => { stopped = true; } }; },
  } } }, services: { ui: { publishView: async (_channel: unknown, value: typeof published[number]) => { published.push(value); } } } } as unknown as PluginContext;
  const view = await emphasisList(ctx), disposable = await view.live!.subscribe("channel" as never);
  await observe([{ id: "one", revision: 1, sessionId: "s", bookId: "b", count: 2, attached: 1, status: "partial", style: "highlight" }]);
  await observe([]);
  expect(published.map(value => [value.revision, value.view.items.length])).toEqual([[1, 1], [2, 0]]);
  disposable.dispose(); expect(stopped).toBe(true);
});
