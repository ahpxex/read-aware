import { expect, test } from "bun:test";
import { registerProfileTools } from "../src/tools";
import { readProfile, saveProfile } from "../src/profiles";
import { fixture } from "./fixture";
import manifest from "../manifest.json";

function setup() {
  const f = fixture(); registerProfileTools(f.ctx);
  const run = (name: string, input: Record<string, unknown>) => f.tools.get(name)!.execute(input) as Promise<Record<string, unknown>>;
  return { ...f, run };
}
test("read-only discovery and approval-gated writes are separated in both scopes", async () => {
  const f = setup();
  expect(f.tools.get("workspace_profiles")!.approval).toBeUndefined();
  for (const name of ["save_workspace_profile", "manage_workspace_profile"]) {
    expect(f.tools.get(name)!.approval).toBe("required");
    expect(f.tools.get(name)!.contexts).toEqual(["global", "book"]);
  }
  expect(manifest.requires.contributions.agentTools).toBe("^1.2.0");
  expect(manifest.requires.services.storage).toBe("^2.1.0");
  for (const operation of ["save", "apply", "delete"]) await expect(f.run("workspace_profiles", { operation })).rejects.toMatchObject({ code: "plugin/invalid-input" });
  expect(f.commits).toHaveLength(0); expect(f.updates).toHaveLength(0);
});
test("save uses the inspected settings and refuses a changed workspace after approval", async () => {
  const f = setup();
  const current = await f.run("workspace_profiles", { operation: "current" });
  expect(current.workspaceToken).toMatch(/^wp1:[a-f0-9]{64}$/);
  expect(current.changes).toHaveLength(10);
  f.values["reading.fontSize"] = 24;
  expect(await f.run("save_workspace_profile", { name: "Reading", workspaceToken: current.workspaceToken })).toEqual({ status: "stale-workspace" });
  expect(f.commits).toHaveLength(0);
  const fresh = await f.run("workspace_profiles", { operation: "current" });
  const saved = await f.run("save_workspace_profile", { name: "Reading", workspaceToken: fresh.workspaceToken });
  expect(saved.status).toBe("saved"); expect(f.commits[0]![0]!.expectedRevision).toBeNull();
  expect(f.updates).toHaveLength(0);
  const inspected = await f.run("workspace_profiles", { operation: "inspect", id: saved.id });
  expect(inspected).toMatchObject({ status: "ready", profile: { version: 2, name: "Reading" } });
  expect(inspected.revision).toBeString();
});
test("apply and delete check exact revision, preserve overrides, and propagate failures", async () => {
  const f = setup(), saved = await saveProfile(f.ctx, "Reading");
  if (saved.status !== "saved") throw Error("Save failed");
  const doc = await readProfile(f.ctx, saved.id);
  for (const action of ["apply", "delete"]) expect(await f.run("manage_workspace_profile", { action, id: saved.id, expectedRevision: "old" })).toMatchObject({ status: "conflict" });
  expect(f.updates).toHaveLength(0); expect(f.documents.has(saved.id)).toBe(true);
  const result = await f.run("manage_workspace_profile", { action: "apply", id: saved.id, expectedRevision: doc.revision });
  expect(result).toMatchObject({ status: "applied", preservedBookOverrides: 1 });
  expect(JSON.stringify(result)).not.toContain('"keep"');
  expect(f.updates[0]).toEqual(doc.data.changes);
  f.fail();
  await expect(f.run("manage_workspace_profile", { action: "apply", id: saved.id, expectedRevision: doc.revision })).rejects.toThrow("rejected stale option");
  await expect(f.run("manage_workspace_profile", { action: "delete", id: saved.id, expectedRevision: doc.revision })).rejects.toThrow("write failed");
  expect(f.documents.has(saved.id)).toBe(true);
});
test("paged discovery returns only summaries and respects stale cursors", async () => {
  const f = setup();
  for (let index = 0; index < 12; index++) await saveProfile(f.ctx, `Profile ${index}`);
  const first = await f.run("workspace_profiles", { operation: "list" });
  expect(first.items).toHaveLength(10); expect(first.nextCursor).toBeString();
  expect(JSON.stringify(first)).not.toContain("reading.fontSize");
  expect((await f.run("workspace_profiles", { operation: "list", cursor: first.nextCursor })).items).toHaveLength(2);
  await saveProfile(f.ctx, "Later");
  expect(await f.run("workspace_profiles", { operation: "list", cursor: first.nextCursor })).toEqual({ status: "stale-cursor" });
});
test("invalid documents can be inspected and conditionally deleted, never applied", async () => {
  const f = setup(); f.documents.set("bad", { secret: "not a profile" });
  expect(await f.run("workspace_profiles", { operation: "inspect", id: "bad" })).toEqual({ status: "invalid-profile", id: "bad", revision: "initial" });
  expect(JSON.stringify(await f.run("workspace_profiles", { operation: "list" }))).not.toContain("secret");
  await expect(f.run("manage_workspace_profile", { action: "apply", id: "bad", expectedRevision: "initial" })).rejects.toMatchObject({ code: "plugin/invalid-input" });
  expect(await f.run("manage_workspace_profile", { action: "delete", id: "bad", expectedRevision: "initial" })).toMatchObject({ status: "deleted" });
  expect(f.documents.size).toBe(0);
  expect(await f.run("workspace_profiles", { operation: "inspect", id: "bad" })).toMatchObject({ status: "not-found" });
});
test("invalid or extra arguments cannot turn reads into writes", async () => {
  const f = setup();
  for (const input of [{ operation: "list", limit: 21 }, { operation: "list", limit: 0 }, { operation: "list", cursor: "" },
    { operation: "current", name: "surprise" }, { operation: "inspect", id: "" }, { operation: "list", id: "unexpected" }]) {
    await expect(f.run("workspace_profiles", input)).rejects.toMatchObject({ code: "plugin/invalid-input" });
  }
  await expect(f.run("save_workspace_profile", { name: "Reading", workspaceToken: "bad" })).rejects.toMatchObject({ code: "plugin/invalid-input" });
  await expect(f.run("manage_workspace_profile", { action: "apply", id: "id", expectedRevision: "r", name: "extra" })).rejects.toMatchObject({ code: "plugin/invalid-input" });
  expect(f.commits).toHaveLength(0); expect(f.updates).toHaveLength(0);
});
test("compiled plugin registers the same three tools and approval contracts", async () => {
  const built = await Bun.build({ entrypoints: [new URL("../src/index.ts", import.meta.url).pathname], target: "browser" });
  expect(built.success).toBe(true);
  const plugin = (await import(`data:text/javascript;base64,${Buffer.from(await built.outputs[0]!.text()).toString("base64")}`)).default;
  const f = fixture(); await plugin.activate(f.ctx);
  expect([...f.tools.keys()]).toEqual(["workspace_profiles", "save_workspace_profile", "manage_workspace_profile"]);
  expect(f.tools.get("manage_workspace_profile")!.approval).toBe("required");
});
