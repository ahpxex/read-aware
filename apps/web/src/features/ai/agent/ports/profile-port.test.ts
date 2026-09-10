import { expect, spyOn, test } from "bun:test";
import { localKV } from "../../../../platform/local-store";
import { createProfilePort } from "./profile-port";
import { buildPluginContext } from "../../../plugins/runtime/plugin-context";
import type { PluginPermission } from "@read-aware/plugin-types";

test("profile writes await persistence and propagate failures", async () => {
  let reject!: (error: Error) => void;
  const write = spyOn(localKV, "setItemAsync").mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  try {
    let settled = false;
    const pending = createProfilePort().putProfileSummary("profile draft");
    void pending.then(() => { settled = true; }, () => { settled = true; });
    expect(write).toHaveBeenCalledWith("read-aware-agent-profile", "profile draft");
    expect(settled).toBe(false);
    reject(new Error("persistence rejected"));
    await expect(pending).rejects.toThrow("persistence rejected");
  } finally {
    write.mockRestore();
  }
});

test("profile reads share the prompt source, propagate failures and reject cancelled delivery", async () => {
  const read = spyOn(localKV, "getItem").mockReturnValue("Existing profile");
  try {
    const port = createProfilePort();
    expect((await port.readProfile()).text).toBe("Existing profile");
    expect(await port.getProfileSummary()).toBe("Existing profile");
    expect(read).toHaveBeenCalledWith("read-aware-agent-profile");
    const controller = new AbortController();
    const pending = port.readProfile({}, controller.signal); controller.abort(new Error("retired"));
    await expect(pending).rejects.toThrow("retired");
    const error = new Error("storage failed"); read.mockImplementation(() => { throw error; });
    await expect(port.readProfile()).rejects.toBe(error);
  } finally { read.mockRestore(); }
});

test("plugin profile query and observation require memory access and retire with the activation", async () => {
  const read = spyOn(localKV, "getItem").mockImplementation(key => key === "read-aware-agent-profile" ? "Reader profile" : null);
  const runtimes: ReturnType<typeof buildPluginContext>[] = [];
  const actor = (permissions: PluginPermission[]) => {
    const runtime = buildPluginContext({ id: "profile-test", name: "Profile", version: "1.0.0", schemaVersion: 1,
      requires: { domains: { memory: "^1.6.0" } }, permissions }, "0.5.4", []);
    runtime.lifecycle.promote(); runtimes.push(runtime); return runtime;
  };
  try {
    expect(actor([]).context.domains.memory).toBeUndefined();
    const runtime = actor(["memory:read"]), memory = runtime.context.domains.memory!;
    expect(memory.commands).toBeUndefined();
    expect((await memory.queries.profile()).text).toBe("Reader profile");
    expect(actor(["memory:write"]).context.domains.memory?.queries.profile).toBeFunction();
    let deliver!: (event: unknown) => void;
    const first = new Promise(resolve => { deliver = resolve; });
    const observation = memory.events.observe({ kind: "profile", query: { limit: 6 } }, deliver);
    expect(await first).toMatchObject({ status: "ready", result: { kind: "profile", profile: { text: "Reader", nextOffset: 6 } } });
    observation.dispose(); runtime.lifecycle.stop();
    await expect(memory.queries.profile()).rejects.toBeDefined();
    expect(() => memory.events.observe({ kind: "profile" }, () => {})).toThrow();
  } finally { for (const runtime of runtimes) runtime.lifecycle.stop(); read.mockRestore(); }
});
