import { expect, test } from "bun:test";
import type { PluginViewResult, PluginView } from "@read-aware/plugin-types";
import { saveProfile } from "../src/profiles";
import { profileView, profilesView } from "../src/views";
import { fixture } from "./fixture";

function action(view: PluginView, id: string) {
  if (view.kind !== "blocks") throw Error("Expected profile detail");
  const group = view.blocks.find(block => block.kind === "actions");
  if (group?.kind !== "actions") throw Error("Actions missing");
  return group.actions.find(item => item.id === id)!;
}
function resultView(result: PluginViewResult): PluginView {
  if (!result?.view) throw Error("View missing");
  return result.view;
}

test("displayed profile revisions protect apply and confirmed deletion", async () => {
  const f = fixture(), saved = await saveProfile(f.ctx, "Reading");
  if (saved.status !== "saved") throw Error("Save failed");
  const detail = await profileView(f.ctx, saved.id);
  const form = resultView(await action(detail, "delete").run!());
  if (form.kind !== "form") throw Error("Expected confirmation");
  expect(await form.onSubmit({ confirm: false })).toMatchObject({ fieldErrors: { confirm: "Confirm deletion first." } });
  expect(f.documents.has(saved.id)).toBe(true);
  f.revisions.set(saved.id, "changed");
  expect(JSON.stringify(await action(detail, "apply").run!())).toContain("The profile changed");
  expect(JSON.stringify(await form.onSubmit({ confirm: true }))).toContain("The profile changed");
  expect(f.updates).toHaveLength(0); expect(f.documents.has(saved.id)).toBe(true);
  const freshForm = resultView(await action(await profileView(f.ctx, saved.id), "delete").run!());
  if (freshForm.kind !== "form") throw Error("Expected confirmation");
  expect(JSON.stringify(await freshForm.onSubmit({ confirm: true }))).toContain("Profile deleted");
  expect(f.documents.size).toBe(0);
});
test("profile pages use host cursors, preserve previous navigation and restart after writes", async () => {
  const f = fixture();
  for (let index = 0; index < 41; index++) await saveProfile(f.ctx, `Profile ${index}`);
  const first = await profilesView(f.ctx);
  if (first.kind !== "list") throw Error("List missing");
  expect(first.items).toHaveLength(40);
  const second = resultView(await first.pagination!.onNext!());
  if (second.kind !== "list") throw Error("List missing");
  expect(second.items).toHaveLength(1); expect(second.pagination!.page).toBe(2);
  expect(second.pagination!.onPrevious).toBeFunction();
  await saveProfile(f.ctx, "Later");
  const stale = resultView(await first.pagination!.onNext!());
  expect(JSON.stringify(stale)).toContain("Profiles changed");
  if (stale.kind !== "detail") throw Error("Stale state missing");
  const refreshed = resultView(await stale.actions![0]!.run!());
  expect(refreshed.kind).toBe("list");
});
test("saved receipts do not depend on re-reading the list and invalid profiles remain removable", async () => {
  const f = fixture();
  const list = await profilesView(f.ctx);
  if (list.kind !== "list") throw Error("List missing");
  const form = resultView(await list.actions!.find(item => item.id === "save")!.run!());
  if (form.kind !== "form") throw Error("Form missing");
  const collection = f.ctx.services.storage.collection;
  f.ctx.services.storage.collection = () => { throw Error("List load failed"); };
  expect(JSON.stringify(await form.onSubmit({ name: "Reading" }))).toContain("Profile saved");
  expect(f.documents.size).toBe(1);
  f.ctx.services.storage.collection = collection;
  f.documents.set("invalid", { version: 2 });
  const detail = await profileView(f.ctx, "invalid");
  expect(action(detail, "apply")).toBeUndefined();
  expect(action(detail, "delete")).toBeDefined();
  expect(JSON.stringify(await profileView({ ...f.ctx, locale: "zh-CN" }, "missing"))).toContain("预设已不存在");
});
