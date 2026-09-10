import { expect, test } from "bun:test";
import type { PluginDetailView, PluginFormView, PluginListView, PluginModule, PluginViewResult, ReadingSessionSnapshot } from "@read-aware/plugin-types";
import type { JumperContext } from "../src/types";
import { navigationTargets, navigationView } from "../src/navigation";

const source = { bookId: "book", contentVersion: "v1" };
const location = { ...source, cfi: "epubcfi(/6/2)" };
function fixture() {
  const calls: unknown[] = [], moves: unknown[] = [];
  let revision = "v1", fail = false, absent = false;
  const session = { status: "ready", bookId: "book", sessionId: "session", location,
    pagination: { layout: "reflowable", flow: "paginated", section: { index: 4, count: 60 }, screen: { index: 2, count: 8 } },
    history: { canGoBack: false, canGoForward: false },
  } as ReadingSessionSnapshot;
  const ctx = { locale: "en", domains: {
    library: { queries: { books: {
      getNavigationToc: async () => ({ bookId: "book", contentVersion: revision, entries: [] }),
      listNavigationTargets: async (q: { contentVersion: string; offset?: number; kind: string }) => {
        calls.push(q);
        if (fail) throw Object.assign(Error("private storage details"), { code: "db/error" });
        if (q.contentVersion !== revision) throw Object.assign(Error("changed"), { code: "reader/stale-location" });
        return { ...source, contentVersion: revision, kind: q.kind, status: absent ? "absent" : "available", total: absent ? 0 : 60,
          nextOffset: absent || q.offset ? null : 40,
          items: absent ? [] : [{ index: q.offset ?? 0, sectionIndex: 4, label: "iv", labelTruncated: false, linear: false, location },
            { index: (q.offset ?? 0) + 1, sectionIndex: 5, label: "iv", labelTruncated: false, linear: true, location: { ...location, cfi: "epubcfi(/6/4)" } },
            { index: (q.offset ?? 0) + 2, sectionIndex: null, label: "Unavailable", labelTruncated: false, linear: null, location: null }],
        };
      },
    } } }, reading: { queries: { session: async () => session }, commands: {
      goTo: async (target: unknown) => { if (fail) throw Object.assign(Error("navigation failure"), { code: "reader/stale-location" }); moves.push(target); return { status: "completed", sessionId: "session", location }; },
      step: async (direction: string, guard: unknown) => { moves.push({ direction, guard }); return { status: "completed", sessionId: "session", location }; },
    }, events: { observeSession: () => ({ dispose() {} }) } },
  } } as unknown as JumperContext;
  return { ctx, session, calls, moves, change: () => { revision = "v2"; }, fail: () => { fail = true; }, absent: () => { absent = true; } };
}
const resultView = (r: PluginViewResult) => r!.view!;
async function action(v: PluginDetailView | PluginListView, id: string) { return (await v.actions!.find(a => a.id === id)!.run())!; }
function menu(v: PluginDetailView) { return v.content.find(b => b.kind === "list") as PluginListView; }

test("navigation separates source-section counts from current-section screen counts", async () => {
  const f = fixture(), view = await navigationView(f.ctx);
  expect(view.content[0]).toMatchObject({ kind: "keyValue", rows: [
    { label: "Source section", value: "5 / 60" }, { label: "Screen in this section", value: "3 / 8" },
  ] });
  expect(f.moves).toHaveLength(0); expect(f.calls).toHaveLength(0);
  f.session.pagination!.screen = null;
  expect((await navigationView(f.ctx)).content[0]).toMatchObject({ rows: [{ label: "Source section", value: "5 / 60" }] });
  f.session.status = "loading";
  await expect(navigationView(f.ctx)).rejects.toMatchObject({ code: "reader/unavailable" });
});

test("all step actions retain the captured book/session guard and await navigation", async () => {
  const f = fixture(), view = await navigationView(f.ctx), choices = menu(view);
  f.session.sessionId = "replacement";
  for (const direction of ["previous", "next", "previous-section", "next-section", "previous-chapter", "next-chapter", "start", "end"]) {
    expect(await choices.items.find(i => i.id === direction)!.onSelect!()).toEqual({ close: true });
    expect(f.moves[f.moves.length - 1]).toEqual({ direction, guard: { bookId: "book", sessionId: "session" } });
  }
  f.ctx.domains.reading.commands.step = async () => { throw Object.assign(Error("retired"), { code: "reader/stale-session" }); };
  await expect(choices.items.find(i => i.id === "next")!.onSelect!()).rejects.toMatchObject({ code: "reader/stale-session" });
});

test("page labels retain duplicate destinations and unavailable targets have no action", async () => {
  const f = fixture(), list = await navigationTargets(f.ctx, source, "pages");
  expect(list.items.map(i => i.id)).toEqual(["0", "1", "2"]);
  expect(list.items.slice(0, 2).map(i => i.title)).toEqual(["iv", "iv"]);
  expect(list.items[0]!.subtitle).toBe("Non-linear section");
  expect(list.items[2]!.onSelect).toBeUndefined();
  await list.items[1]!.onSelect!(); expect(f.moves).toEqual([{ ...location, cfi: "epubcfi(/6/4)" }]);
  f.fail(); await expect(list.items[0]!.onSelect!()).rejects.toMatchObject({ code: "reader/stale-location" });
});

test("catalog paging retains exact offsets/version; explicit refresh obtains a new source version", async () => {
  const f = fixture(), first = await navigationTargets(f.ctx, source, "sections");
  const second = resultView(await first.pagination!.onNext!()) as PluginListView;
  expect(f.calls[1]).toEqual({ ...source, kind: "sections", offset: 40, limit: 40 });
  await second.pagination!.onPrevious!(); expect(f.calls[2]).toEqual({ ...source, kind: "sections", offset: 0, limit: 40 });
  f.change(); await expect(second.pagination!.onPrevious!()).rejects.toMatchObject({ code: "reader/stale-location" });
  await action(second, "refresh"); expect(f.calls[f.calls.length - 1]).toMatchObject({ contentVersion: "v2", offset: 0 });
});

test("numeric source section is one-based and never treated as a printed chapter or page label", async () => {
  const f = fixture(), list = await navigationTargets(f.ctx, source, "sections");
  const form = resultView(await action(list, "find")) as PluginFormView;
  for (const value of [0, -1, 1.5, 61, "iv"]) expect(await form.onSubmit({ number: value })).toHaveProperty("fieldErrors.number");
  expect(f.moves).toHaveLength(0);
  expect(await form.onSubmit({ number: 5 })).toEqual({ close: true });
  expect(f.moves).toEqual([{ ...source, sectionIndex: 4 }]);
});

test("page label search preserves exact labels and absence is not a read failure", async () => {
  const f = fixture(), list = await navigationTargets(f.ctx, source, "pages");
  const form = resultView(await action(list, "find")) as PluginFormView;
  expect(await form.onSubmit({ label: " " })).toHaveProperty("fieldErrors.label");
  expect(await form.onSubmit({ label: "x".repeat(301) })).toHaveProperty("fieldErrors.label");
  await form.onSubmit({ label: " iv " }); expect(f.calls[f.calls.length - 1]).toMatchObject({ label: " iv ", offset: 0, contentVersion: "v1" });
  f.absent(); const absent = await navigationTargets(f.ctx, source, "pages");
  expect(absent.emptyText).toBe("Page labels unavailable"); expect(absent.actions!.map(a => a.id)).toEqual(["refresh"]);
  f.fail(); await expect(navigationTargets(f.ctx, source, "pages")).rejects.toMatchObject({ code: "db/error" });
});

test("compiled Jumper command keeps chapter search first and exposes source navigation", async () => {
  const f = fixture(); let run!: () => Promise<PluginViewResult>;
  const registration = { updateState: async () => {}, dispose() {} };
  Object.assign(f.ctx, { contributions: { commands: { register: (c: { id: string; run: typeof run }) => { if (c.id === "open") run = c.run; return registration; } },
    headerActions: { register: () => registration } } });
  const plugin = (await import(new URL("../dist/main.js", import.meta.url).href)).default as PluginModule;
  await plugin.activate(f.ctx);
  const root = resultView(await run()); if (root.kind !== "blocks") throw Error("Expected root blocks");
  expect(root.blocks[0]!.kind).toBe("form");
  const controls = root.blocks.find(b => b.kind === "actions"); if (controls?.kind !== "actions") throw Error("Expected navigation action");
  const nav = resultView(await controls.actions[0]!.run()) as PluginDetailView;
  await menu(nav).items.find(i => i.id === "pages")!.onSelect!();
  expect(f.calls[0]).toMatchObject({ kind: "pages", contentVersion: "v1" }); expect(f.moves).toHaveLength(0);
});
