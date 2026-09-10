import { expect, mock, test } from "bun:test";
import { PluginLogBudget, createPluginLogging } from "./plugin-logging";
import { PluginLifecycleController } from "./plugin-lifecycle";
import { buildPluginContext } from "./plugin-context";
import { describeContext } from "./plugin-worker-host";

function fixture(budget = new PluginLogBudget(), id = "sample", development = false) {
  const lifecycle = new PluginLifecycleController([]);
  const record = (_message: string, ..._detail: unknown[]): void => {};
  const logger = { debug: mock(record), info: mock(record), warn: mock(record), error: mock(record) };
  return { lifecycle, logger, api: createPluginLogging(id, "1.2.3", lifecycle, { budget, logger, development }) };
}

test("structured logging records authoritative version and phase, rejects content and keeps caller data separate", async () => {
  const f = fixture();
  const entry = { level: "warn" as const, event: "refresh.failed", errorCode: "sync/network", fields: { durationMs: 18, cached: true } };
  expect(await f.api.write(entry)).toEqual({ status: "accepted" });
  entry.fields.durationMs = 0;
  expect(f.logger.warn).toHaveBeenLastCalledWith("plugin-event", { event: "refresh.failed", errorCode: "sync/network", fields: { durationMs: 18, cached: true }, version: "1.2.3", phase: "activating" });
  f.lifecycle.beginMigration();
  await f.api.write({ level: "info", event: "migration.complete" });
  expect(f.logger.info.mock.calls[0]).toEqual(["plugin-event", { event: "migration.complete", version: "1.2.3", phase: "migrating" }]);
  for (const bad of [null, [], { ...entry, pluginId: "other" }, { ...entry, message: "secret" }, { ...entry, level: "fatal" },
    { ...entry, event: "some book text" }, { ...entry, event: "https://example.test" }, { ...entry, errorCode: "Error: secret" },
    { ...entry, fields: { text: "private text" } }, { ...entry, fields: { token: {} } }, { ...entry, fields: { value: NaN } },
    { ...entry, fields: { value: Infinity } }, { ...entry, fields: [] }, { ...entry, fields: { "bad key": true } }]) {
    await expect(f.api.write(bad as never)).rejects.toMatchObject({ code: "plugin/invalid-argument" });
  }
  await expect(f.api.write({ ...entry, fields: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`n${i}`, i])) })).rejects.toMatchObject({ code: "plugin/quota-exceeded" });
  expect(f.logger.warn).toHaveBeenCalledTimes(1);
  f.lifecycle.stop();
  await expect(f.api.write(entry)).rejects.toMatchObject({ code: "plugin/cancelled" });
  await expect(f.api.policy()).rejects.toMatchObject({ code: "plugin/cancelled" });
});

test("rolling budget survives activation replacement and caps all plugins without sleeping or buffering", async () => {
  let now = 0;
  const budget = new PluginLogBudget(() => now);
  const a = fixture(budget, "a");
  const entry = { level: "info" as const, event: "task.completed" };
  for (let i = 0; i < 60; i++) expect((await a.api.write(entry)).status).toBe("accepted");
  a.lifecycle.stop();
  const next = fixture(budget, "a");
  expect(await next.api.write(entry)).toEqual({ status: "rate-limited", retryAfterMs: 60_000 });
  for (const id of ["b", "c", "d", "e"]) {
    const f = fixture(budget, id);
    for (let i = 0; i < 60; i++) expect((await f.api.write(entry)).status).toBe("accepted");
    f.lifecycle.stop();
  }
  const extra = fixture(budget, "f");
  now = 59_999;
  expect(await extra.api.write(entry)).toEqual({ status: "rate-limited", retryAfterMs: 1 });
  expect(extra.logger.info).not.toHaveBeenCalled();
  now = 60_000;
  expect((await extra.api.write(entry)).status).toBe("accepted");
  expect((await next.api.write(entry)).status).toBe("accepted");
  extra.lifecycle.stop(); next.lifecycle.stop();
});

test("production debug is disabled without consuming allowance and policy is a fresh value", async () => {
  const f = fixture();
  const policy = await f.api.policy();
  expect(policy).toMatchObject({ levels: ["info", "warn", "error"], perPluginLimit: 60, appLimit: 300, windowMs: 60000, delivery: "best-effort" });
  policy.levels.length = 0;
  expect((await f.api.policy()).levels).toHaveLength(3);
  for (let i = 0; i < 65; i++) expect(await f.api.write({ level: "debug", event: "step" })).toEqual({ status: "disabled" });
  expect(f.logger.debug).not.toHaveBeenCalled();
  expect((await f.api.write({ level: "error", event: "task.failed" })).status).toBe("accepted");
  const dev = fixture(new PluginLogBudget(), "dev", true);
  expect((await dev.api.policy()).levels).toContain("debug");
  expect((await dev.api.write({ level: "debug", event: "step" })).status).toBe("accepted");
  expect(dev.logger.debug).toHaveBeenCalledTimes(1);
  f.lifecycle.stop(); dev.lifecycle.stop();
});

test("formal plugin context and Worker shape expose only self logging without new permissions", async () => {
  const built = buildPluginContext({ id: "logging-shape", name: "Logging", version: "1.0.0", schemaVersion: 1, requires: { services: { logging: "^1.0" } }, permissions: [] }, "0.5.4", []);
  try {
    expect(built.context.capabilities.services.logging).toBe("1.0.0");
    expect(describeContext(built.context)).toMatchObject({ services: { logging: { write: "fn", policy: "fn" } } });
    expect(Object.keys(built.context.services.logging).sort()).toEqual(["policy", "write"]);
    expect((await built.context.services.logging.policy()).delivery).toBe("best-effort");
    built.lifecycle.stop();
    await expect(built.context.services.logging.write({ level: "info", event: "stale" })).rejects.toMatchObject({ code: "plugin/cancelled" });
  } finally { built.lifecycle.stop(); }
});
