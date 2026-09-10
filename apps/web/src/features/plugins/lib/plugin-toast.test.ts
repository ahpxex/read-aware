import { afterEach, expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import { normalizePluginToast, setPluginToastHandler, showPluginFailureToast, showPluginToast, type PluginToastPayload } from "./plugin-toast";
import { decodePluginCallbacks, PluginCallbackRegistry, releasePluginCallbacks } from "../runtime/plugin-callback-wire";
import { buildPluginContext } from "../runtime/plugin-context";
import { PluginViewSession } from "./plugin-view-session";
import { runPluginContribution } from "./run-result";
import type { PluginToast } from "./plugin-types";
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function fixture() {
  const registry = new PluginCallbackRegistry(), owner = new AbortController();
  const wire = <T,>(value: T): T => decodePluginCallbacks(structuredClone(registry.encode(value)),
    async (id, args) => wire(await registry.invoke(id, args)), handles => registry.release(handles), owner.signal) as T;
  const payloads: PluginToastPayload[] = [];
  setPluginToastHandler(payload => { payloads.push(payload); });
  return { registry, owner, wire, payloads };
}
afterEach(() => setPluginToastHandler(null));
test("failure toasts keep stable host codes but never raw error details", () => {
  const payloads: unknown[] = [];
  setPluginToastHandler(payload => payloads.push(payload));
  showPluginFailureToast("Workspace", new AppError("settings/shortcut-conflict", "private settings payload"));
  expect(payloads).toEqual([{ kind: "failure", pluginName: "Workspace", code: "settings/shortcut-conflict" }]);
  expect(JSON.stringify(payloads)).not.toContain("private settings payload");
});

test("structured errors reject raw details and unknown fields, and terminal codes cannot offer retry", () => {
  const f = fixture();
  for (const code of ["fs/not-found", "not-a-known-code"]) {
    const input = f.wire<PluginToast>({ kind: "error", code, retry: () => { throw Error("must not run"); } });
    showPluginToast(input); releasePluginCallbacks(input);
    expect(f.payloads.at(-1)).toMatchObject({ kind: "failure", code, retry: undefined });
    expect(f.registry.size).toBe(0);
  }
  for (const input of [null, [], {}, { kind: "error", code: "db/locked", message: "PRIVATE" }, { kind: "error", code: "" },
    { kind: "error", code: "x".repeat(129) }, { kind: "error", code: "db/locked", retryable: true },
    { kind: "error", code: "db/locked", retry: "run" }, "x".repeat(16001)]) expect(() => normalizePluginToast(input as never)).toThrow();
  expect(JSON.stringify(f.payloads)).not.toContain("PRIVATE");
});

test("retry retains its callback after action release, runs once, and retirement disables stale buttons", async () => {
  const f = fixture(); let calls = 0, finish!: () => void;
  const input = f.wire<PluginToast>({ kind: "error", code: "db/locked", retry: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  showPluginToast(input); releasePluginCallbacks(input); expect(f.registry.size).toBe(1);
  const payload = f.payloads[0]; if (payload.kind !== "failure") throw Error("Expected failure");
  payload.retry!(); payload.retry!(); await flush(); expect(calls).toBe(1); expect(f.registry.size).toBe(1);
  finish(); await flush(); expect(f.registry.size).toBe(0);
  const other = f.wire<PluginToast>({ kind: "error", code: "db/locked", retry: () => { calls++; } });
  showPluginToast(other); releasePluginCallbacks(other);
  f.owner.abort(); const stale = f.payloads.at(-1); if (stale?.kind === "failure") stale.retry?.();
  await flush(); expect(calls).toBe(1); expect(f.registry.size).toBe(0);
});

test("dismissal, handler teardown and capacity eviction release retained retry handles", () => {
  const f = fixture();
  for (let index = 0; index < 20; index++) {
    const input = f.wire<PluginToast>({ kind: "error", code: "db/locked", retry: () => {} });
    showPluginToast(input); releasePluginCallbacks(input);
  }
  expect(f.registry.size).toBe(16);
  const last = f.payloads.at(-1); if (last?.kind === "failure") last.onDismiss?.();
  expect(f.registry.size).toBe(15); setPluginToastHandler(null); expect(f.registry.size).toBe(0);
});

test("direct plugin calls and view/contribution results share structured dispatch", async () => {
  const f = fixture();
  const runtime = buildPluginContext({ id: "toast-test", name: "Toast", version: "1.0.0", schemaVersion: 1, requires: { services: { ui: "^1.10.0" } } }, "0.5.4", []);
  runtime.lifecycle.promote();
  const session = new PluginViewSession(); session.setRoot({ kind: "markdown", markdown: "View" });
  try {
    runtime.context.services.ui.showToast({ kind: "error", code: "db/locked", retry: () => {} });
    await session.run(() => ({ close: true, toast: f.wire<PluginToast>({ kind: "error", code: "db/locked", retry: () => {} }) }));
    await runPluginContribution("toast-test", "Toast", () => ({ toast: { kind: "error", code: "fs/not-found" } }));
    expect(f.payloads).toHaveLength(3); expect(f.payloads.every(payload => payload.kind === "failure")).toBe(true);
    runtime.lifecycle.stop(); expect(() => runtime.context.services.ui.showToast("late")).toThrow();
  } finally { runtime.lifecycle.stop(); session.dispose(); }
});
