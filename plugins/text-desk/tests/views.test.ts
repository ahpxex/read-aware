import { expect, test } from "bun:test";
import type { PluginContext, PluginDetailView, PluginListView } from "@read-aware/plugin-types";
import { textDesk, textDetail } from "../src/views";

function harness() {
  const calls: string[] = [], opened: string[] = [];
  let fail = "", openFails = false;
  const ctx = { locale: "en", domains: {
    library: { queries: { books: {
      list: async () => Array.from({ length: 22 }, (_, i) => ({ id: String(i), title: `Book ${i}`, format: "epub" })),
      getTextState: async (id: string) => {
        calls.push(id); if (id === fail) throw Error("private native database path");
        return { bookId: id, contentVersion: "v", status: "partial", text: "available", chapterCount: 0,
          progress: { total: 8, completed: 6, failed: 1, unsupported: 1 } };
      },
      getToc: async () => { throw Error("Status inspection must not prepare text"); },
    } } },
    reading: { commands: { openBook: async (bookId: string) => { if (openFails) throw Error("open failed"); opened.push(bookId); } } },
  } } as unknown as PluginContext;
  return { ctx, calls, opened, fail: (id: string) => { fail = id; }, failOpen: () => { openFails = true; } };
}

test("bounded status pages preserve failed books and do not initiate extraction", async () => {
  const h = harness(); h.fail("2");
  const view = await textDesk(h.ctx);
  expect(view.items).toHaveLength(20); expect(h.calls).toHaveLength(20);
  expect(view.items[2]!.subtitle).toContain("Status could not be loaded");
  expect(JSON.stringify(view)).not.toContain("private native");
  const next = await view.actions!.find(action => action.id === "next")!.run();
  expect((next?.view as PluginListView).items).toHaveLength(2); expect(h.calls).toHaveLength(22);
});

test("detail refresh uses new state and opens the selected book only on explicit action", async () => {
  const h = harness();
  const detail = await textDetail(h.ctx, "7", "Book 7");
  expect(h.opened).toEqual([]);
  expect(detail.content[0]).toMatchObject({ kind: "keyValue", rows: expect.arrayContaining([{ label: "Failed sections", value: "1" }]) });
  const refreshed = await detail.actions!.find(action => action.id === "refresh")!.run();
  expect((refreshed?.view as PluginDetailView).title).toBe("Book 7"); expect(h.calls).toEqual(["7", "7"]);
  expect(await detail.actions!.find(action => action.id === "open")!.run()).toEqual({ close: true }); expect(h.opened).toEqual(["7"]);
});

test("failed detail reads and navigation propagate instead of closing or rendering empty", async () => {
  const h = harness(); h.fail("7");
  await expect(textDetail(h.ctx, "7", "Book 7")).rejects.toThrow();
  h.fail(""); const detail = await textDetail(h.ctx, "7", "Book 7"); h.failOpen();
  await expect(detail.actions!.find(action => action.id === "open")!.run()).rejects.toThrow("open failed"); expect(h.opened).toEqual([]);
});
