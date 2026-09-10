import { expect, spyOn, test } from "bun:test";
import type { PluginDocumentChange } from "@read-aware/plugin-types";
import * as ipc from "../../../platform/ipc";
import { createPluginDocuments, normalizeDocumentChanges } from "./plugin-documents";
import { PluginLifecycleController } from "./plugin-lifecycle";
import { AppError } from "@read-aware/core";
import { describeError } from "../../../i18n/describe-error";
import { initI18n } from "../../../i18n";

const revision = "a".repeat(32);
const change: PluginDocumentChange = { kind: "put", collection: "words", id: "hello", expectedRevision: null, data: { word: "hello" } };

test("document service failures have explicit localized copy without blind retry", async () => {
  await initI18n("en");
  for (const code of ["plugin/invalid-argument", "plugin/quota-exceeded"]) {
    const result = describeError(new AppError(code, "PRIVATE_DETAILS"));
    expect(result.retryable).toBe(false);
    expect(result.body).not.toContain("PRIVATE_DETAILS");
  }
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "ru", "fr", "de", "es"]) {
    const catalog = await Bun.file(new URL(`../../../i18n/locales/${locale}/common.json`, import.meta.url)).json();
    expect(catalog.errors.pluginInvalidArgument).toBeTruthy();
    expect(catalog.errors.pluginQuotaExceeded).toBeTruthy();
  }
});

test("document batches validate before dispatch and freeze JSON, identity and provenance", () => {
  const output = normalizeDocumentChanges([change, { kind: "check", collection: "feeds", id: "f", expectedRevision: revision }]);
  expect(output).toEqual([
    { kind: "put", collection: "words", id: "hello", expectedRevision: null, json: '{"word":"hello"}', bookId: undefined, anchor: undefined },
    { kind: "check", collection: "feeds", id: "f", expectedRevision: revision },
  ]);
  for (const changes of [[], [change, change], [{ ...change, expectedRevision: undefined }], [{ ...change, collection: "../other" }],
    [{ ...change, id: "" }], [{ ...change, data: 1n }], [{ ...change, data: () => {} }], [{ ...change, expectedRevision: "bad" }],
    Array.from({ length: 101 }, (_, i) => ({ ...change, id: String(i) }))]) {
    expect(() => normalizeDocumentChanges(changes as PluginDocumentChange[])).toThrow();
  }
  expect(() => normalizeDocumentChanges([{ ...change, data: "x".repeat(4 * 1024 * 1024) }])).toThrow("byte budget");
  expect(() => normalizeDocumentChanges(Array.from({ length: 3 }, (_, i) => ({ ...change, id: String(i), data: "x".repeat(3 * 1024 * 1024) })))).toThrow("byte budget");
});

test("private document context projects page data, conflict and corruption without crossing namespaces", async () => {
  const lifecycle = new PluginLifecycleController([]);
  lifecycle.promote();
  const docs = createPluginDocuments("owner", lifecycle);
  const invoke = spyOn(ipc, "invoke").mockResolvedValue({ status: "ready", items: [{ id: "hello", json: '{"word":"hello"}', updatedAt: "now", revision }], nextCursor: "cursor" });
  try {
    expect(await docs.collection("words").page()).toEqual({ status: "ready", items: [{ id: "hello", data: { word: "hello" }, updatedAt: "now", revision, bookId: undefined, anchor: undefined }], nextCursor: "cursor" });
    expect(invoke).toHaveBeenLastCalledWith("plugin_docs_page", { pluginId: "owner", collection: "words", query: { limit: 50, bookId: undefined, oldestFirst: undefined, cursor: undefined } });
    invoke.mockResolvedValue({ status: "stale-cursor" });
    expect(await docs.collection("words").page({ cursor: "cursor" })).toEqual({ status: "stale-cursor" });
    invoke.mockResolvedValue({ status: "conflict", index: 0 });
    expect(await docs.applyDocuments([change])).toEqual({ status: "conflict", index: 0 });
    expect(invoke.mock.calls.at(-1)?.[1]).toMatchObject({ pluginId: "owner", changes: [{ collection: "words", json: '{"word":"hello"}', expectedRevision: null }] });
    invoke.mockResolvedValue({ id: "broken", json: "bad", updatedAt: "now", revision });
    await expect(docs.collection("words").get("broken")).rejects.toMatchObject({ code: "db/error" });
    expect(() => docs.collection("words").page({ limit: 201 })).toThrow();
    expect(() => docs.collection("words").page({ cursor: "" })).toThrow();
  } finally { lifecycle.stop(); await lifecycle.drainCleanups(); invoke.mockRestore(); }
});

test("accepted document transactions drain on retirement; activation cannot write, migration can", async () => {
  const lifecycle = new PluginLifecycleController([]);
  const docs = createPluginDocuments("owner", lifecycle);
  const invoke = spyOn(ipc, "invoke");
  let finish!: (value: unknown) => void;
  invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }) as never);
  try {
    expect(() => docs.applyDocuments([change])).toThrow("activating");
    expect(invoke).not.toHaveBeenCalled();
    lifecycle.beginMigration();
    const write = docs.applyDocuments([change]);
    lifecycle.stop();
    let drained = false;
    const drain = lifecycle.drainStorageWrites().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    expect(() => docs.applyDocuments([change])).toThrow("stopped");
    expect(() => docs.collection("words").page()).toThrow("stop");
    finish({ status: "applied", documents: [{ collection: "words", id: "hello", revision }] });
    expect((await write).status).toBe("applied");
    await drain; expect(drained).toBe(true);
  } finally { invoke.mockRestore(); }
});
