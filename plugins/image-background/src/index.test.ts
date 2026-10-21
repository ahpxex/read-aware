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
  const deleted: string[] = [],
    released: string[] = [];
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
            return { asset: { ...options, revision: (++sequence).toString(16).padStart(32, "0") } };
          },
          async delete(key: string) {
            deleted.push(key);
          },
        },
      },
      logging: { async write() {} },
    },
  } as unknown as PluginContext;
  return {
    ctx,
    active,
    handles,
    deleted,
    released,
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
  if (result?.view?.kind !== "form") throw new Error("Expected form");
  return result.view.onSubmit({ name, base: baseRef, opacity: 40, dim: 35 });
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
  await create(f, "Cancelled");
  expect(f.document).toBeNull();
  expect(f.active.size).toBe(0);
  expect(f.handles).toHaveLength(0);
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
