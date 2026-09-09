import { expect, test } from "bun:test";
import type { PluginContext, PluginFormView, MemoryMutation } from "@read-aware/plugin-types";
import { memoryDetail } from "../src/management";
const revision = `mem1:${"a".repeat(64)}`;
function fixture(write = true) {
  const writes: MemoryMutation[] = [];
  const ctx = { locale: "en", domains: { memory: { queries: { inspect: async () => ({ revision, memory: { id: "m", scope: "user", content: "Original", pinned: false } }) },
    ...(write ? { commands: { mutate: async (change: MemoryMutation) => { writes.push(change); return { memoryId: "m", revision }; } } } : {}) } } } as unknown as PluginContext;
  return { ctx, writes, view: () => memoryDetail(ctx, "m", async () => ({ kind: "list", title: "Remaining", items: [] })) };
}
test("read-only view does not expose mutation actions", async () => {
  expect((await fixture(false).view()).actions!.map(action => action.id)).toEqual(["refresh"]);
});
test("correction validates and freezes the displayed revision", async () => {
  const f = fixture(), view = await f.view();
  const form = (await view.actions!.find(a => a.id === "correct")!.run())!.view as PluginFormView;
  expect(await form.onSubmit({ content: " " })).toHaveProperty("fieldErrors");
  expect(f.writes).toHaveLength(0);
  await form.onSubmit({ content: "Corrected" });
  expect(f.writes).toEqual([{ op: "correct", memoryId: "m", expectedRevision: revision, content: "Corrected" }]);
});
test("forget requires explicit confirmation and failures retain the form", async () => {
  const f = fixture(), view = await f.view();
  const form = (await view.actions!.find(a => a.id === "forget")!.run())!.view as PluginFormView;
  expect(await form.onSubmit({ confirm: false })).toHaveProperty("fieldErrors"); expect(f.writes).toHaveLength(0);
  f.ctx.domains.memory!.commands!.mutate = async () => { throw Object.assign(Error("changed"), { code: "memory/conflict" }); };
  await expect(form.onSubmit({ confirm: true })).rejects.toMatchObject({ code: "memory/conflict" });
});
