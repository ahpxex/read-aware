import { expect, test } from "bun:test";
import { applyProfile, deleteProfile, LEGACY_PROFILE_PATHS, PROFILE_PATHS, readProfile, saveProfile } from "../src/profiles";
import plugin from "../src/index";
import { fixture } from "./fixture";
test("captures one snapshot, applies one atomic command, and preserves override receipts", async () => {
  const f = fixture(); const saved = await saveProfile(f.ctx, "  Research  ");
  if (saved.status !== "saved") throw Error("Save failed");
  expect(saved.name).toBe("Research"); expect(f.snapshots()).toBe(1); expect(f.updates).toHaveLength(0);
  expect((await readProfile(f.ctx, saved.id)).data.version).toBe(2);
  const applied = await applyProfile(f.ctx, saved.id, (await readProfile(f.ctx, saved.id)).revision);
  if (applied.status !== "applied") throw Error("Apply failed");
  expect(f.updates).toHaveLength(1); expect(f.updates[0]!.map(change => change.path)).toEqual([...PROFILE_PATHS]);
  expect(f.updates[0]!.every(change => change.target?.kind === "global")).toBe(true);
  expect(applied.overrides).toHaveLength(1);
});
test("version 1 presets preserve fonts; version 2 requires its complete field set", async () => {
  const f = fixture();
  const legacy = { version: 1, name: "Old workspace", changes: LEGACY_PROFILE_PATHS.map(path => ({ path, value: "test", target: { kind: "global" } })) };
  f.documents.set("old", legacy);
  await applyProfile(f.ctx, "old", "initial");
  expect(f.updates[0]!.map(change => change.path)).toEqual([...LEGACY_PROFILE_PATHS]);
  expect(f.documents.get("old")).toBe(legacy);
  f.documents.set("broken", { ...legacy, version: 2 });
  await expect(readProfile(f.ctx, "broken")).rejects.toThrow("Invalid workspace profile");
  f.documents.set("null", { ...legacy, changes: [null, ...legacy.changes.slice(1)] });
  await expect(readProfile(f.ctx, "null")).rejects.toThrow("Invalid workspace profile");
});
test("stale settings failures propagate without deleting the saved preset", async () => {
  const f = fixture(); const saved = await saveProfile(f.ctx, "Reading"); f.fail();
  if (saved.status !== "saved") throw Error("Save failed");
  await expect(applyProfile(f.ctx, saved.id, (await readProfile(f.ctx, saved.id)).revision)).rejects.toThrow("rejected stale option");
  expect(f.documents.has(saved.id)).toBe(true); expect(f.updates).toHaveLength(0);
});
test("invalid names, missing documents and tampered paths cannot broaden writes", async () => {
  const f = fixture();
  for (const name of ["", " ", "x".repeat(81)]) await expect(saveProfile(f.ctx, name)).rejects.toThrow();
  const saved = await saveProfile(f.ctx, "Reading");
  if (saved.status !== "saved") throw Error("Save failed");
  const doc = await readProfile(f.ctx, saved.id);
  doc.data.changes[0]!.path = "ai.preferences.localOnly";
  f.documents.set(saved.id, doc.data);
  await expect(applyProfile(f.ctx, saved.id, doc.revision)).rejects.toThrow("Invalid workspace profile");
  expect(await applyProfile(f.ctx, "missing", "initial")).toEqual({ status: "conflict" });
  expect(f.updates).toHaveLength(0);
});
test("deleting a preset does not apply any host settings", async () => {
  const f = fixture(); const saved = await saveProfile(f.ctx, "Reading");
  if (saved.status !== "saved") throw Error("Save failed");
  await deleteProfile(f.ctx, saved.id, (await readProfile(f.ctx, saved.id)).revision);
  expect(f.documents.size).toBe(0); expect(f.updates).toHaveLength(0);
});
test("registers shelf UI, command and both Agent scopes", () => {
  const f = fixture();
  plugin.activate(f.ctx);
  expect(f.registrations).toEqual(["header", "command", "tool", "tool", "tool"]);
  expect(f.tools.get("workspace_profiles")).toMatchObject({ name: "workspace_profiles", contexts: ["global", "book"] });
});
