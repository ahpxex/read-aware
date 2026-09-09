import { expect, test } from "bun:test";
import type { PluginContext } from "@read-aware/plugin-types";
import { applyProfile, deleteProfile, PROFILE_PATHS, readProfile, saveProfile } from "../src/profiles";
import plugin from "../src/index";

function fixture() {
  type Change = Parameters<PluginContext["domains"]["settings"]["commands"]["update"]>[0][number];
  const documents = new Map<string, unknown>();
  const updates: Change[][] = [];
  let snapshots = 0;
  let fail = false;
  const ctx = { locale: "en", domains: { settings: {
    queries: { snapshot: async () => {
      snapshots++;
      return { settings: PROFILE_PATHS.map(path => ({ path, value: path === "shelf.layout" ? "list" : "test", writable: true })) };
    } },
    commands: { update: async (changes: Change[]) => {
      if (fail) throw Error("rejected stale option");
      updates.push(changes);
      return { changed: changes, settings: { overrides: [{ target: { kind: "book", bookId: "keep" }, paths: ["reading.fontSize"] }] } };
    } },
  } },
    services: { storage: { collection: () => ({ put: async (id: string, data: unknown) => { documents.set(id, data); },
      get: async (id: string) => documents.has(id) ? { id, data: documents.get(id) } : null,
      list: async () => [...documents].map(([id, data]) => ({ id, data })), delete: async (id: string) => { documents.delete(id); } }) } },
  } as unknown as PluginContext;
  return { ctx, documents, updates, snapshots: () => snapshots, fail() { fail = true; } };
}
test("captures one snapshot, applies one atomic command, and preserves override receipts", async () => {
  const f = fixture(); const saved = await saveProfile(f.ctx, "  Research  ");
  expect(saved.name).toBe("Research"); expect(f.snapshots()).toBe(1); expect(f.updates).toHaveLength(0);
  const applied = await applyProfile(f.ctx, saved.id);
  expect(f.updates).toHaveLength(1); expect(f.updates[0]!.map(change => change.path)).toEqual([...PROFILE_PATHS]);
  expect(f.updates[0]!.every(change => change.target?.kind === "global")).toBe(true);
  expect(applied.overrides).toHaveLength(1);
});
test("stale settings failures propagate without deleting the saved preset", async () => {
  const f = fixture(); const saved = await saveProfile(f.ctx, "Reading"); f.fail();
  await expect(applyProfile(f.ctx, saved.id)).rejects.toThrow("rejected stale option");
  expect(f.documents.has(saved.id)).toBe(true); expect(f.updates).toHaveLength(0);
});
test("invalid names, missing documents and tampered paths cannot broaden writes", async () => {
  const f = fixture();
  for (const name of ["", " ", "x".repeat(81)]) await expect(saveProfile(f.ctx, name)).rejects.toThrow();
  const saved = await saveProfile(f.ctx, "Reading");
  const doc = await readProfile(f.ctx, saved.id);
  doc.data.changes[0]!.path = "ai.preferences.localOnly";
  await expect(applyProfile(f.ctx, saved.id)).rejects.toThrow("Invalid workspace profile");
  await expect(applyProfile(f.ctx, "missing")).rejects.toThrow();
  expect(f.updates).toHaveLength(0);
});
test("deleting a preset does not apply any host settings", async () => {
  const f = fixture(); const saved = await saveProfile(f.ctx, "Reading");
  await deleteProfile(f.ctx, saved.id);
  expect(f.documents.size).toBe(0); expect(f.updates).toHaveLength(0);
});
test("registers shelf UI, command and both Agent scopes", () => {
  const registrations: Array<{ family: string; value: unknown }> = [];
  const contribution = (family: string) => ({ register: (value: unknown) => registrations.push({ family, value }) });
  const f = fixture(); Object.assign(f.ctx, { contributions: { headerActions: contribution("header"), commands: contribution("command"), agentTools: contribution("tool") } });
  plugin.activate(f.ctx);
  expect(registrations.map(entry => entry.family)).toEqual(["header", "command", "tool"]);
  expect(registrations[2]!.value).toMatchObject({ name: "workspace_profiles", contexts: ["global", "book"] });
});
