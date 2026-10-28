import { expect, test } from "bun:test";

if (process.env.ROAMING_PREFERENCE_WRITE_PROOF === "1") {
  type Call = { command: string; args: any };
  const calls: Call[] = [];
  let failWrite: unknown;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: any) => {
          calls.push({ command, args });
          if (command === "local_device_get")
            return { deviceId: "roaming-proof", lastHlcWallMs: null, lastHlcCounter: null };
          // Simulate the event append failing: only the write carrying an event fails.
          if (failWrite && (command === "commit_events" || (command === "set_kv_batch" && args.events?.length)))
            throw failWrite;
          if (command === "atomic_commit")
            return {
              status: "applied",
              events: { appended: args.input.events.length, applied: args.input.events.length },
              documents: [],
            };
          return undefined;
        },
      },
    },
  });
  const { localKV } = await import("./local-store");
  await import("./roaming-preferences");
  const { onDomainEventBroadcast } = await import("./domain-events");
  const { onAppEvent } = await import("./app-events");
  const { commitAtomicHostPlan } = await import("./atomic-commit");
  const broadcasts: { key: string; value: unknown }[] = [];
  onDomainEventBroadcast((event) => {
    if (event.type === "preference.changed") broadcasts.push(event.payload as never);
  });
  const failures: unknown[] = [];
  onAppEvent("local-write-failed", (failure) => failures.push(failure));
  const since = (start: number) =>
    calls.slice(start).filter((call) => call.command !== "local_device_get" && !call.command.startsWith("plugin:log|"));

  test("a roaming save commits its KV bytes and preference event in one native write", async () => {
    const start = calls.length;
    await localKV.setItemAsync("read-aware-ai-config", '{"provider":"custom","apiKey":"PRIVATE-KEY"}', "user");
    const [write] = since(start);
    expect(since(start)).toHaveLength(1);
    expect(write).toMatchObject({
      command: "set_kv_batch",
      args: { entries: [["read-aware-ai-config", '{"provider":"custom","apiKey":"PRIVATE-KEY"}']] },
    });
    // The stripped credential never enters the log.
    expect(write!.args.events.map((event: any) => [event.type, event.aggregateId, event.payload])).toEqual([
      ["preference.changed", "read-aware-ai-config", { key: "read-aware-ai-config", value: { provider: "custom" } }],
    ]);
    expect(broadcasts.at(-1)).toEqual({ key: "read-aware-ai-config", value: { provider: "custom" } });
    await localKV.removeItemAsync("read-aware-app-settings");
    expect(calls.at(-1)!.args.events[0].payload).toEqual({ key: "read-aware-app-settings", value: null });
  });

  test("a failed roaming save rolls back KV, reports local-write-failed and never announces its event", async () => {
    await localKV.setItemAsync("read-aware-app-settings", '{"theme":"light"}');
    const announced = broadcasts.length,
      reported = failures.length;
    failWrite = { code: "db/locked", message: "event log unavailable" };
    const write = localKV.setItemAsync("read-aware-app-settings", '{"theme":"dark"}');
    expect(localKV.getItem("read-aware-app-settings")).toBe('{"theme":"dark"}');
    await expect(write).rejects.toMatchObject({ code: "db/locked" });
    failWrite = undefined;
    expect(localKV.getItem("read-aware-app-settings")).toBe('{"theme":"light"}');
    expect(failures.slice(reported)).toEqual([expect.objectContaining({ kind: "kv", code: "db/locked" })]);
    expect(broadcasts).toHaveLength(announced);
  });

  test("device-local keys, non-JSON values and remote overlays carry no event", async () => {
    const start = calls.length;
    await localKV.setItemAsync("read-aware-reader-settings", '{"fontSize":18}');
    await localKV.setItemAsync("read-aware-plugin.sample.raw", "not json");
    localKV.setItem("read-aware-app-settings", '{"theme":"remote"}', "remote");
    await Bun.sleep(0);
    expect(since(start).map((call) => call.command)).toEqual(["set_kv", "set_kv", "set_kv"]);
  });

  test("an atomic plan carries the preference events of its roaming settings", async () => {
    const start = calls.length;
    await commitAtomicHostPlan(
      {
        guards: [],
        events: [],
        documents: [],
        journal: { id: "roaming", owner: "user", metadata: {} },
        settings: [
          { key: "read-aware-app-settings", expected: '{"theme":"remote"}', value: '{"theme":"atomic"}' },
          { key: "read-aware-reader-settings", expected: '{"fontSize":18}', value: '{"fontSize":20}' },
        ],
      },
      "user",
      { assertAuthorized() {}, committed() {} },
    );
    const [commit] = since(start);
    expect(commit!.command).toBe("atomic_commit");
    expect(commit!.args.input.events.map((event: any) => event.payload)).toEqual([
      { key: "read-aware-app-settings", value: { theme: "atomic" } },
    ]);
    expect(broadcasts.at(-1)).toEqual({ key: "read-aware-app-settings", value: { theme: "atomic" } });
  });
} else {
  test("isolated roaming preference write contract", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, ROAMING_PREFERENCE_WRITE_PROOF: "1" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const output = await new Response(child.stderr).text();
    expect(await child.exited, output).toBe(0);
    expect(output).toContain("4 pass");
  }, 30_000);
}
