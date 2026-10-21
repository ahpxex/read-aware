import { expect, test } from "bun:test";
import type { PluginContext, PluginReaderThemeBase, PluginRuntimeTheme, PluginView } from "@read-aware/plugin-types";
import plugin from "./index";

const base = (ref: string): PluginReaderThemeBase => ({
  ref,
  name: ref,
  polarity: ref === "dark" ? "dark" : "light",
  reader: {
    palette: {
      bg: ref === "dark" ? "#111" : "#fff",
      text: "#333",
      selection: "#eee",
      rule: "#aaa",
      faint: "#eee",
      muted: "#777",
    },
    typography: { fontFamily: "plugin:editorial-themes:eb-garamond", fontSize: "large" },
  },
});
function fixture(initial: unknown = null) {
  let document = initial;
  let page: { view(): PluginView | Promise<PluginView> };
  const active = new Map<string, PluginRuntimeTheme>();
  let picked = true,
    failWrite = false,
    failImage = false;
  let openFailure: unknown = null;
  const deleted: string[] = [],
    released: string[] = [],
    storedAssets: string[] = [],
    logged: { level: string; event: string }[] = [];
  const assetNames = new Map<string, string>();
  const handles: { disposed: boolean }[] = [];
  let sequence = 0;
  const ctx = {
    locale: "en",
    contributions: {
      themes: {
        async readerBases() {
          return [base("warm"), base("dark")];
        },
        async register(theme: PluginRuntimeTheme) {
          if (failImage) {
            failImage = false;
            throw new Error("bad image");
          }
          active.set(theme.id, theme);
          const handle = { disposed: false };
          handles.push(handle);
          return {
            dispose() {
              handle.disposed = true;
              if (active.get(theme.id) === theme) active.delete(theme.id);
            },
          };
        },
      },
      settingsPage: {
        register(value: typeof page) {
          page = value;
        },
      },
      commands: { register() {} },
    },
    // Deliberately no domains.settings: creating a theme cannot select it.
    services: {
      storage: {
        collection: () => ({
          async get() {
            return document ? { data: structuredClone(document) } : null;
          },
          async put(_id: string, value: unknown) {
            if (failWrite) throw new Error("write failed");
            document = structuredClone(value);
          },
        }),
      },
      resources: {
        async pick() {
          return { resources: picked ? [{ id: "picked", name: "background.png" }] : [] };
        },
        async release(id: string) {
          released.push(id);
        },
        assets: {
          async store(_id: string, options: { key: string; name: string }) {
            storedAssets.push(options.key);
            assetNames.set(options.key, options.name);
            return { asset: { ...options, revision: (++sequence).toString(16).padStart(32, "0") } };
          },
          async open(key: string, _revision: string) {
            if (openFailure) {
              const error = openFailure;
              openFailure = null;
              throw error;
            }
            return { id: `asset:${key}`, name: assetNames.get(key) ?? key };
          },
          async delete(key: string) {
            deleted.push(key);
          },
        },
      },
      logging: {
        async write(entry: { level: string; event: string }) {
          logged.push(entry);
        },
      },
    },
  } as unknown as PluginContext;
  return {
    ctx,
    active,
    handles,
    deleted,
    released,
    storedAssets,
    logged,
    root: () => page.view(),
    get document() {
      return document;
    },
    cancel() {
      picked = false;
    },
    failWrite() {
      failWrite = true;
    },
    failImage() {
      failImage = true;
    },
    failOpen(error: unknown) {
      openFailure = error;
    },
    retire() {
      active.clear();
    },
  };
}
async function action(view: PluginView, id: string) {
  if (view.kind !== "detail") throw new Error("Expected detail");
  return view.actions!.find((entry) => entry.id === id)!.run();
}
async function create(f: ReturnType<typeof fixture>, name: string, baseRef = "warm") {
  const result = await action(await f.root(), "create");
  if (result?.view?.kind !== "blocks") throw new Error("Expected draft blocks");
  const [image, form] = result.view.blocks;
  if (image?.kind !== "image" || form?.kind !== "form") throw new Error("Expected image and form blocks");
  return form.onSubmit({ name, base: baseRef, opacity: 40, dim: 35 });
}
async function detail(f: ReturnType<typeof fixture>, name: string) {
  const root = await f.root();
  if (root.kind !== "detail") throw new Error("Expected detail");
  const list = root.content.find((block) => block.kind === "list");
  if (list?.kind !== "list") throw new Error("Expected list");
  return (await list.items.find((entry) => entry.title === name)!.onSelect!())!.view!;
}

test("multiple named themes inherit independent palettes and typography, survive reload and can be removed separately", async () => {
  const f = fixture();
  await plugin.activate(f.ctx);
  await create(f, "Paper");
  await create(f, "Night", "dark");
  expect(f.active.size).toBe(2);
  const night = [...f.active.values()].find((entry) => entry.name === "Night")!;
  expect(night.reader).toEqual(base("dark").reader);
  expect(night.polarity).toBe("dark");
  f.retire();
  await plugin.activate(f.ctx);
  expect(f.active.size).toBe(2);
  expect(f.active.get(night.id)?.readerBackground).toMatchObject({ opacity: 0.4, dim: 0.35 });
  await action(await detail(f, "Night"), "remove");
  expect([...f.active.values()].map((entry) => entry.name)).toEqual(["Paper"]);
  expect(f.deleted).toHaveLength(1);
});

test("cancel and invalid fields do not create assets or publish a theme", async () => {
  const f = fixture();
  await plugin.activate(f.ctx);
  expect(await create(f, " ")).toMatchObject({ fieldErrors: { name: expect.any(String) } });
  f.cancel();
  expect(await action(await f.root(), "create")).toBeNull();
  expect(f.document).toBeNull();
  expect(f.active.size).toBe(0);
  expect(f.handles).toHaveLength(0);
});

test("a cancelled picker stays on the list and publishes nothing", async () => {
  const f = fixture();
  await plugin.activate(f.ctx);
  f.cancel();
  expect(await action(await f.root(), "create")).toBeNull();
  expect(f.document).toBeNull();
  expect(f.active.size).toBe(0);
  expect(f.released).toHaveLength(0);
  expect(f.storedAssets).toHaveLength(0);
});

test("the draft shows the picked image, prefills its name and releases the resource exactly once", async () => {
  const f = fixture();
  await plugin.activate(f.ctx);
  const result = await action(await f.root(), "create");
  if (result?.view?.kind !== "blocks") throw new Error("Expected draft blocks");
  expect(result.view.blocks[0]).toMatchObject({ kind: "image", resourceId: "picked", alt: "background.png" });
  const form = result.view.blocks[1];
  if (form?.kind !== "form") throw new Error("Expected form");
  expect(form.fields.find((field) => field.id === "name")).toMatchObject({ value: "background" });
  expect(await form.onSubmit({ name: " ", base: "warm", opacity: 40, dim: 35 })).toMatchObject({
    fieldErrors: { name: expect.any(String) },
  });
  expect(f.released).toHaveLength(0);
  expect(await form.onSubmit({ name: "Fresh", base: "warm", opacity: 40, dim: 35 })).toMatchObject({
    navigation: "reset",
  });
  expect(f.released).toEqual(["picked"]);
  expect(f.document).toMatchObject({ version: 2, themes: [{ name: "Fresh" }] });
  await result.view.onClose?.({ reason: "reset" });
  expect(f.released).toEqual(["picked"]);
});

test("closing the draft without saving releases the picked resource once and stores nothing", async () => {
  const f = fixture();
  await plugin.activate(f.ctx);
  const result = await action(await f.root(), "create");
  if (result?.view?.kind !== "blocks") throw new Error("Expected draft blocks");
  await result.view.onClose?.({ reason: "closed" });
  await result.view.onClose?.({ reason: "closed" });
  expect(f.released).toEqual(["picked"]);
  expect(f.document).toBeNull();
  expect(f.active.size).toBe(0);
  expect(f.storedAssets).toHaveLength(0);
});

test("the list subtitle shows base, opacity and dimming rather than the file name", async () => {
  const f = fixture();
  await plugin.activate(f.ctx);
  await create(f, "Paper");
  const root = await f.root();
  if (root.kind !== "detail") throw new Error("Expected detail");
  const list = root.content.find((block) => block.kind === "list");
  if (list?.kind !== "list") throw new Error("Expected list");
  expect(root.content.some((block) => block.kind === "text")).toBe(false);
  const item = list.items.find((entry) => entry.title === "Paper")!;
  expect(item.subtitle).toBe("warm · Opacity 40% · Dimming 35%");
  expect(item.subtitle).not.toContain("background.png");
});

test("the detail shows an image preview and saved values, delete is destructive and closing releases the preview", async () => {
  const f = fixture();
  await plugin.activate(f.ctx);
  await create(f, "Paper");
  const view = await detail(f, "Paper");
  if (view.kind !== "detail") throw new Error("Expected detail");
  const preview = view.content[0];
  if (preview?.kind !== "image") throw new Error("Expected image preview");
  const key = [...f.storedAssets][0]!;
  expect(preview).toMatchObject({ resourceId: `asset:${key}`, alt: "background.png" });
  const facts = view.content[1];
  if (facts?.kind !== "keyValue") throw new Error("Expected keyValue");
  expect(facts.layout).toBe("inline");
  expect(facts.rows).toEqual([
    { label: "Base theme", value: "warm" },
    { label: "Image opacity", value: "40%" },
    { label: "Dimming", value: "35%" },
    { label: "Image file", value: "background.png" },
  ]);
  expect(view.content.some((block) => block.kind === "text")).toBe(false);
  const remove = view.actions!.find((entry) => entry.id === "remove")!;
  expect(remove.variant).toBe("danger");
  expect(remove.priority).toBe("secondary");
  await view.onClose?.({ reason: "closed" });
  expect(f.released[f.released.length - 1]).toBe(`asset:${key}`);
});

test("a failed preview renders a localized error and closes without releasing", async () => {
  const f = fixture();
  await plugin.activate(f.ctx);
  await create(f, "Paper");
  f.failOpen({ code: "plugin/asset-conflict" });
  const view = await detail(f, "Paper");
  if (view.kind !== "detail") throw new Error("Expected detail");
  expect(view.content[0]).toEqual({ kind: "error", code: "plugin/asset-conflict" });
  expect(f.logged).toContainEqual({ level: "warn", event: "background.preview-failed" });
  const released = f.released.length;
  await view.onClose?.({ reason: "closed" });
  expect(f.released).toHaveLength(released);
});

test("failed persistence and corrupt image replacements keep the saved theme and release new resources", async () => {
  const f = fixture();
  await plugin.activate(f.ctx);
  await create(f, "Original");
  const before = f.document,
    original = [...f.active.values()][0];
  f.failImage();
  await expect(action(await detail(f, "Original"), "replace")).rejects.toThrow("bad image");
  expect(f.active.get(original!.id)).toBe(original!);
  f.failWrite();
  await expect(action(await detail(f, "Original"), "replace")).rejects.toThrow("write failed");
  expect(f.document).toEqual(before);
  expect(f.active.get(original!.id)).toEqual(original!);
  expect(f.handles.map((entry) => entry.disposed)).toEqual([true, true, false]);
  expect(f.deleted).toHaveLength(2);
  expect(f.released).toHaveLength(3);
});

test("editing preserves identity and image, rejects duplicate names and keeps other themes", async () => {
  const f = fixture();
  await plugin.activate(f.ctx);
  await create(f, "A");
  await create(f, "B");
  const original = [...f.active.values()][0]!;
  const result = await action(await detail(f, "A"), "edit");
  if (result?.view?.kind !== "form") throw new Error("Expected form");
  expect(await result.view.onSubmit({ name: "B", base: "dark", opacity: 30, dim: 0 })).toMatchObject({
    fieldErrors: { name: expect.any(String) },
  });
  await result.view.onSubmit({ name: "Renamed", base: "dark", opacity: 30, dim: 0 });
  expect(f.active.size).toBe(2);
  expect(f.active.get(original.id)).toMatchObject({
    name: "Renamed",
    polarity: "dark",
    readerBackground: { assetKey: original.readerBackground!.assetKey, opacity: 0.3 },
  });
  expect(f.deleted).toHaveLength(0);
});

test("legacy single-picture data keeps its selected reference and migrates on the next edit", async () => {
  const legacy = { key: "old", revision: "a".repeat(32), name: "old.png", opacity: 0.25, dim: 0 };
  const f = fixture(legacy);
  await plugin.activate(f.ctx);
  expect(f.document).toEqual(legacy);
  expect(f.active.has("picture")).toBe(true);
  await create(f, "Second");
  expect(f.document).toMatchObject({
    version: 2,
    themes: [{ id: "picture", image: { key: "old" } }, { name: "Second" }],
  });
  expect(f.active.size).toBe(2);
});
