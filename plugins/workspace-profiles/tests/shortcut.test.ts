import { expect, test } from "bun:test";
import type { PluginContext } from "@read-aware/plugin-types";
import { shortcutView } from "../src/shortcut";

const path = "shortcuts.plugin.workspace-profiles%3Aopen";
function fixture(overridden = false, writable = true) {
  const updates: unknown[] = [];
  const queries: unknown[] = [];
  let failure: Error | undefined;
  const ctx = { manifest: { id: "workspace-profiles" }, locale: "en", domains: { settings: {
    queries: { snapshot: async (query: unknown) => {
      queries.push(query);
      return { settings: [{ path, writable, value: overridden ? ["mod", "shift", "p"] : null, shortcut: { overridden } }] };
    } },
    commands: { update: async (changes: unknown) => { if (failure) throw failure; updates.push(changes); } },
  } } } as unknown as PluginContext;
  return { ctx, updates, queries, fail(error: Error) { failure = error; } };
}

test("own command shortcut form reflects the effective binding and writes one exact path", async () => {
  const f = fixture(true);
  const view = await shortcutView(f.ctx);
  expect(f.queries).toEqual([{ section: "shortcuts" }]);
  expect(view.fields.map(field => [field.id, "value" in field ? field.value : undefined])).toEqual([
    ["mode", "custom"], ["mod", true], ["alt", false], ["shift", true], ["key", "p"],
  ]);
  expect(await view.onSubmit({ mode: "custom", mod: true, alt: true, shift: false, key: "j" })).toMatchObject({ close: true });
  expect(f.updates).toEqual([[{ path, value: ["mod", "alt", "j"] }]]);
});

test("default removes the override instead of writing a default chord", async () => {
  const f = fixture(true);
  await (await shortcutView(f.ctx)).onSubmit({ mode: "default", mod: true, key: "p" });
  expect(f.updates).toEqual([[{ path, value: null }]]);
});

test("missing write grant and host conflicts cannot produce a success result", async () => {
  await expect(shortcutView(fixture(false, false).ctx)).rejects.toThrow("unavailable");
  const f = fixture();
  const error = Object.assign(Error("Conflict"), { code: "settings/shortcut-conflict" });
  f.fail(error);
  await expect((await shortcutView(f.ctx)).onSubmit({ mode: "custom", mod: true, key: "k" })).rejects.toBe(error);
  expect(f.updates).toEqual([]);
});
