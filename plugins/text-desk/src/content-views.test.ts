import { expect, test } from "bun:test";
import type { PluginContext, PluginDetailView, PluginLibraryDomain, PluginListView, PluginModule, PluginView } from "@read-aware/plugin-types";
import { contentSections } from "./content-sections";
import { referenceDetail, referenceList } from "./reference-views";
import { imageDetail, imageList } from "./image-views";
import { textDetail } from "./views";

type Books = PluginLibraryDomain["queries"]["books"];
function fixture() {
  const source = { bookId: "book", contentVersion: "v1", sectionIndex: 7 };
  const reference = { ...source, index: 3 };
  const location = { bookId: "book", contentVersion: "v1", href: "chapter.xhtml#figure" };
  const image = { image: reference, alt: "A diagram", location };
  const resource = { id: "image-resource", name: "image.png", mimeType: "image/png", size: 100, state: "ready" as const, expiresAt: 99, source: "image" as const };
  const calls: unknown[][] = [];
  let preview: Awaited<ReturnType<Books["readReference"]>> = {
    reference, location, status: "resolved", label: "Note", text: "First page", offset: 0, totalLength: 6000, nextOffset: 3999,
  };
  const queries = {
    list: async () => [{ id: "book", title: "Book", format: "epub" }],
    getTextState: async () => ({ status: "ready", text: "available", chapterCount: 10 }),
    getNavigationToc: async (id: string) => { calls.push(["version", id]); return { bookId: id, contentVersion: "v1", entries: [] }; },
    listNavigationTargets: async (input: Parameters<Books["listNavigationTargets"]>[0]) => {
      calls.push(["sections", input]);
      return { bookId: "book", contentVersion: "v1", kind: "sections", status: "available", total: 21, nextOffset: input.offset ? null : 20,
        items: [{ index: input.offset ?? 0, sectionIndex: 7, label: "Chapter", location, labelTruncated: false, linear: true }] };
    },
    listReferences: async (input: Parameters<Books["listReferences"]>[0]) => {
      calls.push(["references", input]); return { ...source, status: "available", total: 21, nextOffset: input.offset ? null : 20,
        items: [{ reference, label: "Note", kind: "inline-note" }] };
    },
    readReference: async (input: Parameters<Books["readReference"]>[0]) => {
      calls.push(["read", input]); return input.offset ? { ...preview, offset: input.offset, text: "Last page", nextOffset: null } : preview;
    },
    listImages: async (input: Parameters<Books["listImages"]>[0]) => {
      calls.push(["images", input]); return { ...source, status: "available", total: 21, nextOffset: input.offset ? null : 20, items: [image] };
    },
    openImageResource: async (input: Parameters<Books["openImageResource"]>[0]) => {
      calls.push(["image-resource", input]); return { status: "ready", image, resource };
    },
  };
  const resources = {
    save: async (...args: unknown[]) => { calls.push(["save", ...args]); return { saved: true }; },
    release: async (id: string) => { calls.push(["release", id]); },
  };
  const ctx = { locale: "en", domains: { library: { queries: { books: queries }, commands: { books: {} } }, reading: {
    queries: { session: async () => ({ bookId: "book", status: "ready", sessionId: "session" }) },
    commands: { goTo: async (target: unknown) => { calls.push(["goTo", target]); }, openBook: async (id: string) => {
      calls.push(["open", id]); return { sessionId: "opened" };
    } },
  } }, services: { resources, clipboard: { writeImage: async (id: string) => { calls.push(["copy", id]); return { copied: true, width: 10, height: 10 }; } },
    ui: { reader: {
      previewReference: async (...args: unknown[]) => { calls.push(["native-reference", ...args]); return { status: "opened", id: "note", sessionId: "session", preview }; },
      image: { open: async (...args: unknown[]) => { calls.push(["native-image", ...args]); return { status: "opened", snapshot: { id: "viewer" } }; } },
    } },
  } } as unknown as PluginContext;
  return { ctx, source, reference, location, image, resource, resources, queries, calls,
    setPreview(value: typeof preview) { preview = value; }, get preview() { return preview; } };
}
const action = (view: PluginView, id: string) => (view as PluginDetailView).actions!.find(item => item.id === id)!;

test("source catalog uses actual section indices and freezes content version across next and previous", async () => {
  const f = fixture(), first = await contentSections(f.ctx, "book", "Book", "references");
  expect(f.calls).toEqual([["version", "book"], ["sections", { bookId: "book", contentVersion: "v1", kind: "sections", offset: 0, limit: 20 }]]);
  await first.items[0].onSelect!();
  expect(f.calls[2]).toEqual(["references", { ...f.source, offset: 0, limit: 20 }]);
  const next = (await first.pagination!.onNext!())!.view! as PluginListView;
  expect(next.pagination!.page).toBe(2);
  expect(next.pagination!.onNext).toBeUndefined();
  await next.pagination!.onPrevious!();
  expect(f.calls.filter(call => call[0] === "version")).toHaveLength(1);
  expect(f.calls.filter(call => call[0] === "sections").map(call => (call[1] as { offset: number }).offset)).toEqual([0, 20, 0]);
});

test("reference browsing is read-only; exact text offsets survive back navigation", async () => {
  const f = fixture(), list = await referenceList(f.ctx, f.source);
  const detail = (await list.items[0].onSelect!())!.view!;
  const next = (await action(detail, "next").run())!.view!;
  await action(next, "previous").run();
  expect(f.calls.filter(call => call[0] === "read").map(call => call[1])).toEqual([
    { reference: f.reference, offset: 0, limit: 4000 }, { reference: f.reference, offset: 3999, limit: 4000 }, { reference: f.reference, offset: 0, limit: 4000 },
  ]);
  expect(f.calls.some(call => ["open", "goTo", "native-reference"].includes(call[0] as string))).toBe(false);
  expect(await action(detail, "open-source").run()).toEqual({ close: true });
  expect(f.calls[f.calls.length - 1]).toEqual(["goTo", f.location]);
});

test("native reference opens only on explicit action using the current session guard", async () => {
  const f = fixture(), detail = await referenceDetail(f.ctx, f.reference);
  expect(await action(detail, "native-preview").run()).toEqual({ close: true });
  expect(f.calls[f.calls.length - 1]).toEqual(["native-reference", { reference: f.reference, offset: 0, limit: 4000 }, { bookId: "book", sessionId: "session" }]);
  f.ctx.services.ui.reader!.previewReference = async () => ({ status: "not-opened", preview: { ...f.preview, status: "missing", location: undefined } });
  expect(await action(detail, "native-preview").run()).toEqual({ toast: "Reference target not found" });
});

test("external and blocked reference targets stay plain data without open or fetch actions", async () => {
  const f = fixture();
  for (const status of ["external", "blocked", "missing", "unsupported"] as const) {
    f.setPreview({ ...f.preview, status, location: undefined, text: "", url: status === "external" ? "https://example.org/note" : undefined, nextOffset: null });
    const detail = await referenceDetail(f.ctx, f.reference);
    expect(detail.actions).toEqual([]);
    expect(detail.content[0].kind).toBe("text");
    if (status === "external") expect(detail.content[1]).toEqual({ kind: "text", text: "https://example.org/note" });
  }
  expect(f.calls.every(call => call[0] === "read")).toBe(true);
});

test("image catalog does not open bytes until selected; acquired image is displayed and released on close", async () => {
  const f = fixture(), list = await imageList(f.ctx, f.source);
  expect(f.calls).toEqual([["images", { ...f.source, offset: 0, limit: 20 }]]);
  const detail = (await list.items[0].onSelect!())!.view!;
  expect((detail as PluginDetailView).content[0]).toEqual({ kind: "image", resourceId: "image-resource", alt: "A diagram" });
  expect(await action(detail, "copy-image").run()).toEqual({ toast: "Image copied" });
  expect(await action(detail, "save-image").run()).toEqual({ toast: "Image saved" });
  f.resources.save = async () => ({ saved: false });
  expect(await action(detail, "save-image").run()).toBeNull();
  await detail.onClose!({ reason: "back" });
  expect(f.calls[f.calls.length - 1]).toEqual(["release", "image-resource"]);
  const next = (await list.pagination!.onNext!())!.view! as PluginListView;
  await next.pagination!.onPrevious!();
  expect(f.calls.filter(call => call[0] === "images").map(call => (call[1] as { offset: number }).offset)).toEqual([0, 20, 0]);
});

test("missing/external/unsupported image is not a fake preview or an implicit network request", async () => {
  const f = fixture();
  for (const status of ["missing", "external", "unsupported"] as const) {
    f.ctx.domains.library!.queries.books.openImageResource = async () => ({ status, image: f.image });
    const detail = await imageDetail(f.ctx, f.image) as PluginDetailView;
    expect(detail.content[0].kind).toBe("text");
    expect(detail.actions).toBeUndefined();
  }
  expect(f.calls).toEqual([]);
});

test("native image handoff ensures the matching book first; not-opened and errors never close as success", async () => {
  const f = fixture();
  f.ctx.domains.reading!.queries.session = async () => ({ bookId: "other", status: "ready" }) as never;
  const detail = await imageDetail(f.ctx, f.image);
  expect(await action(detail, "native-image").run()).toEqual({ close: true });
  expect(f.calls.slice(-2)).toEqual([["open", "book"], ["native-image", { image: f.reference }, { bookId: "book", sessionId: "opened" }]]);
  f.ctx.services.ui.reader!.image!.open = async () => ({ status: "not-opened", reason: "unsupported" });
  expect(await action(detail, "native-image").run()).toEqual({ toast: "Unsupported image" });
  f.ctx.services.ui.reader!.image!.open = async () => { throw Object.assign(Error("private detail"), { code: "reader/stale-location" }); };
  await expect(action(detail, "native-image").run()).rejects.toMatchObject({ code: "reader/stale-location" });
  await detail.onClose!({ reason: "closed" });
});

test("failed and stale queries propagate rather than becoming empty catalogs", async () => {
  const f = fixture(), error = Object.assign(Error("private detail"), { code: "reader/stale-location" });
  f.ctx.domains.library!.queries.books.listImages = async () => { throw error; };
  f.ctx.domains.library!.queries.books.listReferences = async () => { throw error; };
  f.ctx.domains.library!.queries.books.readReference = async () => { throw error; };
  await expect(imageList(f.ctx, f.source)).rejects.toBe(error);
  await expect(referenceList(f.ctx, f.source)).rejects.toBe(error);
  await expect(referenceDetail(f.ctx, f.reference)).rejects.toBe(error);
});

test("both source and compiled entry expose image and reference workflows from book detail", async () => {
  const f = fixture(), source = await textDetail(f.ctx, "book", "Book");
  expect(action(source, "references")).toBeDefined(); expect(action(source, "images")).toBeDefined();
  const compiled = (await import(new URL("../dist/main.js", import.meta.url).href)).default as PluginModule;
  let header: Parameters<PluginContext["contributions"]["headerActions"]["register"]>[0] | undefined;
  f.ctx.contributions = { commands: { register() {} }, selectionActions: { register() {} },
    headerActions: { register(value: typeof header) { header = value; } },
  } as unknown as PluginContext["contributions"];
  await compiled.activate(f.ctx);
  const root = await header!.view({}) as PluginListView;
  const detail = (await root.items[0].onSelect!())!.view!;
  const sections = (await action(detail, "images").run())!.view! as PluginListView;
  const images = (await sections.items[0].onSelect!())!.view! as PluginListView;
  expect(images.items[0].presentation).toBe("dialog");
  const preview = (await images.items[0].onSelect!())!.view!;
  expect(action(preview, "image-controls")).toBeDefined();
  expect((preview as PluginDetailView).content[0]).toMatchObject({ kind: "image", resourceId: "image-resource" });
  await preview.onClose!({ reason: "closed" });
});
