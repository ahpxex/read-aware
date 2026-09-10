import { expect, test } from "bun:test";
import type { AgentRuntime, OneShotInput } from "@read-aware/agent";
import { createPluginLlm, PluginInferenceSlots } from "./plugin-llm";
import { PluginLifecycleController } from "./plugin-lifecycle";
import { buildPluginContext } from "./plugin-context";
import { AppError } from "@read-aware/core";
import { describeError } from "../../../i18n/describe-error";
import { initI18n } from "../../../i18n";

test("inference control errors use localized copy and distinguish retryable capacity from cancellation", async () => {
  await initI18n("en");
  for (const code of ["ai/request-cancelled", "ai/request-timeout", "ai/busy"]) {
    const result = describeError(new AppError(code, "PRIVATE_MODEL_DETAILS"));
    expect(result.body).not.toContain("PRIVATE_MODEL_DETAILS");
    expect(result.retryable).toBe(code === "ai/busy");
  }
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"]) {
    const catalog = await Bun.file(new URL(`../../../i18n/locales/${locale}/common.json`, import.meta.url)).json();
    for (const key of ["aiRequestCancelled", "aiRequestTimeout", "aiBusy"]) expect(catalog.errors[key]).toBeTruthy();
  }
});

function fixture(capacity = new PluginInferenceSlots(), id = "sample") {
  const lifecycle = new PluginLifecycleController([]); lifecycle.promote();
  const calls: Array<{ input: OneShotInput; finish(value: unknown): void }> = [];
  const runtime = { ask(input: OneShotInput) {
    const source = new Promise<unknown>(resolve => { calls.push({ input, finish: resolve }); });
    input.trackSource?.(source);
    return new Promise((resolve, reject) => {
      const abort = () => reject(input.signal?.reason);
      input.signal?.addEventListener("abort", abort, { once: true });
      void source.then(value => { input.signal?.removeEventListener("abort", abort); resolve(value); });
    });
  } } as Pick<AgentRuntime, "ask">;
  return { lifecycle, calls, api: createPluginLlm(id, lifecycle, () => runtime, capacity) };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("LLM policy, validation and pre-cancellation reject before inference", async () => {
  const f = fixture();
  expect(await f.api.policy()).toEqual({ defaultTimeoutMs: 60000, maxTimeoutMs: 110000, perPluginLimit: 2, appLimit: 8 });
  for (const timeoutMs of [0, 110001, 1.5, NaN]) await expect(f.api.ask({ prompt: "p", timeoutMs })).rejects.toMatchObject({ code: "plugin/invalid-argument" });
  await expect(f.api.ask({ prompt: "p", schema: {}, onText() {} } as never)).rejects.toMatchObject({ code: "plugin/invalid-argument" });
  const controller = new AbortController(); controller.abort();
  await expect(f.api.ask({ prompt: "p", signal: controller.signal })).rejects.toMatchObject({ code: "ai/request-cancelled" });
  expect(f.calls).toHaveLength(0);
  f.lifecycle.stop();
});

test("cancelled inference keeps slots and retirement waiting until provider termination", async () => {
  const capacity = new PluginInferenceSlots();
  const f = fixture(capacity);
  const controller = new AbortController();
  const first = f.api.ask({ prompt: "first", signal: controller.signal });
  const second = f.api.ask({ prompt: "second", signal: controller.signal });
  const cancelled = Promise.allSettled([first, second]);
  await tick();
  controller.abort();
  for (const result of await cancelled) expect(result).toMatchObject({ status: "rejected", reason: { code: "ai/request-cancelled" } });
  expect(f.calls.every(call => call.input.signal?.aborted)).toBe(true);
  f.lifecycle.stop();
  const replacement = fixture(capacity);
  await expect(replacement.api.ask({ prompt: "blocked" })).rejects.toMatchObject({ code: "ai/busy" });
  let drained = false;
  const drain = f.lifecycle.drainCleanups().then(() => { drained = true; });
  await tick(); expect(drained).toBe(false);
  for (const call of f.calls) call.finish("late");
  await drain; expect(drained).toBe(true);
  const next = replacement.api.ask({ prompt: "next" });
  await tick(); replacement.calls[0].finish("ok");
  expect(await next).toBe("ok");
  replacement.lifecycle.stop(); await replacement.lifecycle.drainCleanups();
});

test("deadline aborts inference and a successful structured call keeps its input snapshot", async () => {
  const f = fixture();
  const request = f.api.ask({ prompt: "timeout", timeoutMs: 5 });
  await expect(request).rejects.toMatchObject({ code: "ai/request-timeout" });
  expect(f.calls[0].input.signal?.aborted).toBe(true);
  f.calls[0].finish("late"); await f.lifecycle.drainCleanups();
  const schema = { type: "object", required: ["answer"] };
  const readingContext = { selection: "original" };
  const next = f.api.ask({ prompt: "p", schema, readingContext });
  schema.required.push("later"); readingContext.selection = "changed";
  await tick();
  expect(f.calls[1].input.schema).toEqual({ type: "object", required: ["answer"] });
  expect(f.calls[1].input.readingContext).toEqual({ selection: "original" });
  f.calls[1].finish({ answer: "ok" }); expect(await next).toEqual({ answer: "ok" });
  f.lifecycle.stop(); await f.lifecycle.drainCleanups();
});

test("global slots bound different plugin owners and service remains permission gated", () => {
  const capacity = new PluginInferenceSlots();
  const releases = Array.from({ length: 8 }, (_, i) => capacity.acquire(`plugin-${i}`));
  expect(() => capacity.acquire("another")).toThrow("capacity");
  releases[0](); releases[0]();
  const release = capacity.acquire("another"); release();
  for (const release of releases) release();
  const built = buildPluginContext({ id: "llm-denied", name: "Denied", version: "1.0.0", schemaVersion: 1, permissions: [], requires: {} }, "1", []);
  expect(built.context.services.llm).toBeUndefined();
  built.lifecycle.stop();
});
