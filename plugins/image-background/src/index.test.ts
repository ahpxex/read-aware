import { expect, test } from "bun:test";
import type { PluginContext, PluginHeaderAction, PluginRuntimeTheme, PluginView } from "@read-aware/plugin-types";
import plugin from "./index";

function fixture() {
  let document: unknown = null;
  let header: PluginHeaderAction;
  let active: PluginRuntimeTheme | undefined;
  let picked = true;
  let failSettings = false;
  const deleted: string[] = [];
  const released: string[] = [];
  const settings: unknown[] = [];
  const registrations: { disposed: boolean }[] = [];
  let sequence = 0;
  const ctx = {
    locale: "zh-CN",
    contributions: {
      themes: {
        async register(theme: PluginRuntimeTheme) {
          active = theme;
          const handle = { disposed: false };
          registrations.push(handle);
          return {
            dispose() {
              handle.disposed = true;
              if (active === theme) active = undefined;
            },
          };
        },
      },
      commands: { register() {} },
      headerActions: {
        register(value: PluginHeaderAction) {
          header = value;
        },
      },
    },
    domains: {
      settings: {
        commands: {
          async update(value: unknown) {
            if (failSettings) throw new Error("settings failed");
            settings.push(value);
          },
        },
      },
    },
    services: {
      storage: {
        collection: () => ({
          async get() {
            return document ? { data: structuredClone(document) } : null;
          },
          async put(_id: string, value: unknown) {
            document = structuredClone(value);
          },
          async delete() {
            document = null;
          },
        }),
      },
      resources: {
        async pick() {
          return { resources: picked ? [{ id: "picked", name: "背景.png" }] : [] };
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
  const view = async () => header.view({ book: { id: "book-1", title: "Book" } });
  const action = async (id: string) => {
    const current = await view();
    if (current.kind !== "detail") throw new Error("Expected detail");
    return current.actions!.find((item) => item.id === id)!.run();
  };
  return {
    ctx,
    view,
    action,
    deleted,
    released,
    registrations,
    settings,
    get document() {
      return document;
    },
    get active() {
      return active;
    },
    cancel() {
      picked = false;
    },
    failSettings() {
      failSettings = true;
    },
  };
}

test("cancel does not change reading settings or store an image", async () => {
  const f = fixture();
  await plugin.activate(f.ctx);
  f.cancel();
  await f.action("choose");
  expect(f.document).toBeNull();
  expect(f.settings).toEqual([]);
  expect(f.registrations).toEqual([]);
});

test("choose, adjust, reload and remove preserve the selected image and settings", async () => {
  const f = fixture();
  await plugin.activate(f.ctx);
  await f.action("choose");
  expect(f.settings[0]).toEqual([
    { path: "reading.theme", value: "plugin:image-background:picture", target: { kind: "global" } },
    { path: "reading.theme", value: "plugin:image-background:picture", target: { kind: "book", bookId: "book-1" } },
  ]);
  expect(f.released).toEqual(["picked"]);
  const result = await f.action("adjust");
  const form: PluginView | undefined = result?.view;
  if (form?.kind !== "form") throw new Error("Expected form");
  await form.onSubmit({ opacity: 40, dim: 35 });
  expect(f.active?.readerBackground).toMatchObject({ opacity: 0.4, dim: 0.35 });
  expect(f.registrations[0]?.disposed).toBe(true);
  await plugin.activate(f.ctx);
  expect(f.active?.readerBackground).toMatchObject({ opacity: 0.4, dim: 0.35 });
  await f.action("remove");
  expect(f.document).toBeNull();
  expect(f.active).toBeUndefined();
  expect(f.deleted).toHaveLength(1);
});

test("a failed replacement restores the previous image and releases temporary assets and registrations", async () => {
  const f = fixture();
  await plugin.activate(f.ctx);
  await f.action("choose");
  const before = f.document;
  const oldTheme = f.active;
  f.failSettings();
  await expect(f.action("choose")).rejects.toThrow("settings failed");
  expect(f.document).toEqual(before);
  expect(f.active).toEqual(oldTheme);
  expect(f.registrations.map((handle) => handle.disposed)).toEqual([true, true, false]);
  expect(f.deleted).toHaveLength(1);
  expect(f.deleted[0]).not.toBe(oldTheme?.readerBackground?.assetKey);
  expect(f.released).toEqual(["picked", "picked"]);
});
