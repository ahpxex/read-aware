import { expect, test } from "bun:test";
import type { PluginContext, PluginDetailView, PluginListView, PluginModule, PluginViewResult } from "@read-aware/plugin-types";
import { imageControls, openImageControls } from "./image-controls";

type ImageService = NonNullable<NonNullable<PluginContext["services"]["ui"]["reader"]>["image"]>;
type Snapshot = Awaited<ReturnType<ImageService["snapshot"]>>;
type Request = Parameters<NonNullable<ImageService["control"]>>[0];
const state = (id = "viewer"): NonNullable<Snapshot> => ({ id, bookId: "book", sessionId: "session", revision: 1,
  scale: 1.5, rotation: 90, panX: -0.15, panY: 0.2 });

function fixture(locale = "en") {
  let snapshot: Snapshot = state(), observer!: (value: Snapshot) => unknown;
  let failure: Error | undefined, disposed = 0;
  let openResult: Awaited<ReturnType<NonNullable<ImageService["open"]>>> = { status: "opened", snapshot: state() };
  const requests: Request[] = [], opened: unknown[][] = [];
  const published: { revision: number; view: PluginDetailView }[] = [];
  const ctx = { locale, domains: { library: { commands: {}, queries: { books: { list: async () => [] } } },
    reading: { queries: { session: async () => ({ bookId: "book", sessionId: "session", status: "ready" }) }, commands: {
      openBook: async (bookId: string) => { opened.push(["book", bookId]); return { sessionId: "opened-session" }; },
    } } }, services: { ui: { reader: { image: {
      snapshot: async () => { if (failure) throw failure; return snapshot; },
      observe: (handler: typeof observer) => { observer = handler; return { dispose() { disposed++; } }; },
      control: async (request: Request) => {
        if (failure) throw failure;
        if (request.id !== snapshot?.id) throw Object.assign(Error("Changed viewer"), { code: "reader/superseded" });
        requests.push(request);
        return request.action === "close" ? { status: "closed", id: request.id } : { status: "updated", snapshot };
      },
      open: async (...args: unknown[]) => { opened.push(["image", ...args]); return openResult; },
    } }, publishView: async (_channel: unknown, frame: typeof published[number]) => { published.push(frame); } } } } as unknown as PluginContext;
  return { ctx, requests, opened, published, set: (value: Snapshot) => { snapshot = value; },
    emit: async (value: Snapshot) => { snapshot = value; await observer(value); },
    fail: () => { failure = Object.assign(Error("Private native detail"), { code: "reader/superseded" }); },
    openResult: (value: typeof openResult) => { openResult = value; }, disposed: () => disposed };
}
const action = async (view: PluginDetailView | PluginListView, id: string) => (await view.actions!.find(item => item.id === id)!.run())!;

test("image inspector reads actual normalized metadata without changing the viewer", async () => {
  const f = fixture(), view = await imageControls(f.ctx);
  expect(view.content).toEqual([{ kind: "keyValue", rows: [
    { label: "Zoom", value: "150%" }, { label: "Rotation", value: "90°" },
    { label: "Horizontal offset", value: "-15%" }, { label: "Vertical offset", value: "20%" },
  ] }]);
  expect(f.requests).toEqual([]); expect(f.opened).toEqual([]);
  expect(view.actions!.map(item => item.id)).toEqual(["zoom-in", "zoom-out", "rotate", "reset", "panLeft", "panRight",
    "panUp", "panDown", "show-image", "close-image", "refresh"]);
});

test("every image operation uses the captured viewer id and relative pan units", async () => {
  const f = fixture(), view = await imageControls(f.ctx);
  for (const id of ["zoom-in", "zoom-out", "rotate", "reset", "panLeft", "panRight", "panUp", "panDown"]) {
    expect(await action(view, id)).toEqual({ toast: "Image updated" });
  }
  expect(f.requests).toEqual([
    { id: "viewer", action: "zoom-in" }, { id: "viewer", action: "zoom-out" },
    { id: "viewer", action: "rotate" }, { id: "viewer", action: "reset" },
    { id: "viewer", action: "pan", dx: -0.15, dy: 0 }, { id: "viewer", action: "pan", dx: 0.15, dy: 0 },
    { id: "viewer", action: "pan", dx: 0, dy: -0.15 }, { id: "viewer", action: "pan", dx: 0, dy: 0.15 },
  ]);
  expect(await action(view, "show-image")).toEqual({ close: "all" });
  expect(f.requests).toHaveLength(8);
  expect(await action(view, "close-image")).toEqual({ close: "all" });
  expect(f.requests[8]).toEqual({ id: "viewer", action: "close" });
});

test("live views follow replacement and close; old callbacks cannot operate the new viewer", async () => {
  const f = fixture(), view = await imageControls(f.ctx);
  const sub = await view.live!.subscribe({ id: "channel" });
  await f.emit(state()); await f.emit(state("replacement"));
  await expect(action(view, "zoom-in")).rejects.toMatchObject({ code: "reader/superseded" });
  await action(f.published[1].view, "rotate");
  expect(f.requests).toEqual([{ id: "replacement", action: "rotate" }]);
  await f.emit(null);
  expect(f.published[2].view.actions!.map(item => item.id)).toEqual(["refresh"]);
  expect(f.published.map(item => item.revision)).toEqual([1, 2, 3]);
  sub.dispose(); sub.dispose(); await f.emit(state());
  expect(f.disposed()).toBe(1); expect(f.published).toHaveLength(3);
});

test("no open image is an honest empty state and refresh explicitly discovers a later viewer", async () => {
  const f = fixture(); f.set(null);
  const view = await imageControls(f.ctx);
  expect(view.content).toEqual([{ kind: "text", text: "No image viewer open" }]);
  expect(view.actions!.map(item => item.id)).toEqual(["refresh"]);
  f.set(state("later"));
  const result = await action(view, "refresh");
  expect(result.navigation).toBe("replace");
  await action(result.view as PluginDetailView, "zoom-in");
  expect(f.requests[0].id).toBe("later");
});

test("missing services and host errors propagate, without false empty/success or closing", async () => {
  const f = fixture(), view = await imageControls(f.ctx); f.fail();
  await expect(action(view, "close-image")).rejects.toMatchObject({ code: "reader/superseded" });
  await expect(imageControls(f.ctx)).rejects.toMatchObject({ code: "reader/superseded" });
  expect(f.requests).toEqual([]);
  delete f.ctx.services.ui.reader!.image;
  await expect(imageControls(f.ctx)).rejects.toMatchObject({ code: "ui/unavailable" });
});

test("opening controls from a source image uses its version and a ready session guard", async () => {
  const f = fixture(), query = { image: { bookId: "book", contentVersion: "v1", sectionIndex: 3, index: 2 } };
  f.ctx.domains.reading!.queries.session = async () => ({ status: "idle", bookId: null }) as never;
  expect((await openImageControls(f.ctx, query)).view?.title).toBe("Image controls");
  expect(f.opened).toEqual([["book", "book"], ["image", query, { bookId: "book", sessionId: "opened-session" }]]);
  for (const reason of ["missing", "external", "unsupported"] as const) {
    f.openResult({ status: "not-opened", reason });
    const result = await openImageControls(f.ctx, query);
    expect(result.view).toBeUndefined(); expect(result.toast).toBeString();
  }
});

test("image labels and receipts are translated in all supported locales", async () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"]) {
    const f = fixture(locale), view = await imageControls(f.ctx);
    expect(view.title).toBeString();
    for (const item of view.actions!) expect(item.label.length).toBeGreaterThan(0);
    expect((await action(view, "zoom-in")).toast).toBeString();
  }
  expect((await imageControls(fixture("zh-Hans").ctx)).title).toBe("图片控制");
});

test("compiled command exposes the image workflow with existing grants and retains the reader entry", async () => {
  const f = fixture(), commands = new Map<string, () => Promise<PluginViewResult>>();
  let header!: Parameters<PluginContext["contributions"]["headerActions"]["register"]>[0];
  f.ctx.contributions = { commands: { register(value: { id: string; run: () => Promise<PluginViewResult> }) { commands.set(value.id, value.run); } },
    headerActions: { register(value: typeof header) { header = value; } }, selectionActions: { register() {} },
  } as unknown as PluginContext["contributions"];
  const plugin = (await import(new URL("../dist/main.js", import.meta.url).href)).default as PluginModule;
  await plugin.activate(f.ctx);
  expect(header.presentation).toBe("popup");
  const direct = (await commands.get("image-controls")!())!.view as PluginDetailView;
  expect((await header.view({})).kind).toBe("list");
  await action(direct, "reset");
  expect(f.requests).toEqual([{ id: "viewer", action: "reset" }]);
  const manifest = await Bun.file(new URL("../dist/manifest.json", import.meta.url)).json();
  expect(manifest.version).toBe("0.11.1");
  expect(manifest.requires.schemas.views).toBe("^1.9.0");
  expect(manifest.requires.services.ui).toBe("^1.13.0");
  expect(manifest.permissions).toEqual(["library:write", "reading:write", "service:clipboard"]);
});
