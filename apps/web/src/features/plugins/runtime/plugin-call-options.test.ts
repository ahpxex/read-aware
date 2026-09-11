import { expect, spyOn, test } from "bun:test";
import { PLUGIN_CALL_OPTIONS, preparePluginCall, injectPluginCallSignal, pluginOperationSignal } from "./plugin-call-options";
import { buildPluginContext } from "./plugin-context";
import { PluginLifecycleController } from "./plugin-lifecycle";
import * as navigation from "../../library/lib/book-content-navigation";

test("every supported option slot strips local signals, preserves guards and receives authoritative RPC signals", () => {
  const caller = new AbortController(), host = new AbortController();
  for (const [method, index] of Object.entries(PLUGIN_CALL_OPTIONS)) {
    const args: unknown[] = Array.from({ length: index }, (_, i) => i ? { sessionId: "s" } : "input");
    args.push({ signal: caller.signal });
    const prepared = preparePluginCall(method, args);
    expect(prepared.signal).toBe(caller.signal);
    expect(prepared.args.slice(0, index)).toEqual(args.slice(0, index));
    expect(prepared.args[index]).toBeUndefined();
    expect(args[index]).toEqual({ signal: caller.signal });
    prepared.args[index] = { signal: { forged: true } };
    injectPluginCallSignal(method, prepared.args, host.signal);
    expect(prepared.args[index]).toEqual({ signal: host.signal });
  }
  expect(Object.keys(PLUGIN_CALL_OPTIONS)).toHaveLength(34);
  const args = ["not an options slot"];
  expect(preparePluginCall("services.storage.get", args).args).toBe(args);
  injectPluginCallSignal("services.storage.get", args, host.signal);
  expect(args).toEqual(["not an options slot"]);
  for (const invalid of [null, false, [], { timeoutMs: 1 }, { signal: {} }]) {
    expect(() => pluginOperationSignal(host.signal, invalid as never)).toThrow("Invalid plugin call options");
  }
});

test("all registered host methods observe pre-cancellation without granting extra domains", () => {
  const built = buildPluginContext({ id: "cancel-probe", name: "Cancel", version: "1", schemaVersion: 1,
    requires: { domains: { library: "^1.17.0", reading: "^2.18.0" }, services: { diagnostics: "^1.0.0" } },
    permissions: ["library:read", "reading:write", "memory:write", "service:diagnostics", "service:sync", "service:network"] }, "1", []);
  built.lifecycle.promote();
  const controller = new AbortController(), reason = new Error("cancel this call only"); controller.abort(reason);
  try {
    for (const [path, index] of Object.entries(PLUGIN_CALL_OPTIONS)) {
      let method: unknown = built.context;
      for (const key of path.split(".")) method = (method as Record<string, unknown>)[key];
      expect(typeof method).toBe("function");
      const args = Array<unknown>(index).fill(undefined); args.push({ signal: controller.signal });
      expect(() => (method as (...args: unknown[]) => unknown)(...args)).toThrow(reason);
    }
    expect(built.lifecycle.signal.aborted).toBe(false);
    expect(built.context.domains.annotations).toBeUndefined();
  } finally { built.lifecycle.stop(); }
});

test("actual search forwarding cancels only that query while its source remains owned until settlement", async () => {
  let finish!: () => void, signal: AbortSignal | undefined;
  const source = new Promise<void>(resolve => { finish = resolve; });
  const spy = spyOn(navigation, "searchBookLocations").mockImplementation(async (_input, inputSignal) => {
    signal = inputSignal; await source; inputSignal?.throwIfAborted();
    throw new Error("Unexpected successful search");
  });
  const built = buildPluginContext({ id: "search-cancel", name: "Search", version: "1", schemaVersion: 1,
    requires: {}, permissions: ["library:read"] }, "1", []);
  built.lifecycle.promote();
  try {
    const caller = new AbortController();
    const pending = built.context.domains.library!.queries.books.searchLocations({ bookId: "b", query: "q" }, { signal: caller.signal });
    await Promise.resolve(); caller.abort(new Error("query replaced"));
    await expect(pending).rejects.toThrow("query replaced");
    expect(signal?.aborted).toBe(true); expect(built.lifecycle.signal.aborted).toBe(false);
    let drained = false;
    const drain = built.lifecycle.drainCleanups().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    finish(); await drain;
    expect(drained).toBe(true);
  } finally { finish(); built.lifecycle.stop(); await built.lifecycle.drainCleanups(); spy.mockRestore(); }
});

test("cancelled reads do not free source capacity early and do not cancel sibling reads", async () => {
  const lifecycle = new PluginLifecycleController([]); lifecycle.promote();
  const caller = new AbortController();
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const pending = Array.from({ length: 32 }, () => lifecycle.read("bounded", async signal => { await gate; signal.throwIfAborted(); }, caller.signal));
  const settled = Promise.allSettled(pending);
  await Promise.resolve(); caller.abort(new Error("stopped")); await settled;
  expect(() => lifecycle.read("blocked", async () => {})).toThrow("capacity");
  expect(lifecycle.signal.aborted).toBe(false);
  finish(); await lifecycle.drainCleanups();
  const a = new AbortController();
  const sibling = lifecycle.read("sibling", async () => "ok");
  const cancelled = lifecycle.read("cancelled", async () => "late", a.signal);
  a.abort(new Error("just this call"));
  await expect(cancelled).rejects.toThrow("just this call");
  expect(await sibling).toBe("ok");
  lifecycle.stop(); await lifecycle.drainCleanups();
});
