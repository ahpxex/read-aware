import { afterEach, describe, expect, mock, test } from "bun:test";
import type { PluginContext, PluginHeaderAction, PluginCommand, PluginView, PluginViewResult } from "@read-aware/plugin-types";
import plugin from "../src/index";
import { Operations, type Outcome } from "../src/operations";
import { catalogViews } from "../src/catalog";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function view(result: PluginViewResult): PluginView {
  if (!result?.view) throw Error("Expected a view");
  return result.view;
}
function action(current: PluginView, id: string) {
  if (!("actions" in current)) throw Error("Expected actions");
  const found = current.actions?.find(item => item.id === id);
  if (!found) throw Error(`Missing action: ${id}`);
  return found;
}
async function select(current: PluginView, id: string) {
  if (current.kind !== "list") throw Error("Expected a list");
  return view(await current.items.find(item => item.id === id)!.onSelect!());
}
const model = { id: "model-1", name: "Model One", reasoning: true, input: ["text" as const, "image" as const], contextWindow: 100000, maxOutputTokens: 4000 };
const catalogPage = { provider: "openai", revision: 7, refreshing: false, checkedAt: null, errorCode: null as string | null,
  models: [model], total: 26, offset: 0, nextOffset: 25 as number | null };

function fixture() {
  let header!: PluginHeaderAction, command!: PluginCommand;
  const connection = deferred<{ action: "test"; status: "responded" | "empty" | "cancelled" }>();
  const backup = deferred<{ action: "import" | "export"; status: "imported" | "exported" | "cancelled" }>();
  const report = deferred<{ action: "export" | "send"; status: "exported" | "sent" | "cancelled" }>();
  const verification = deferred<{ consistent: boolean; eventsReplayed: number; driftedTables: number; onlyLiveRows: number; onlyReplayedRows: number }>();
  const requestConnectionTest = mock((_options: { signal: AbortSignal }) => connection.promise);
  const requestBackup = mock((_action: "import" | "export", _options: { signal: AbortSignal }) => backup.promise);
  const requestReport = mock((_action: "export" | "send", _options: { signal: AbortSignal }) => report.promise);
  const verifyProjections = mock((_options: { signal: AbortSignal }) => verification.promise);
  const modelCatalog = mock(async (_query: Record<string, unknown>) => catalogPage);
  const refreshModelCatalog = mock(async (_provider: string, _options: { signal: AbortSignal }) => catalogPage);
  const publishView = mock(async (_channel: unknown, _update: { revision: number; view: PluginView }) => ({ status: "applied" }));
  const ctx = {
    locale: "en", domains: { settings: { queries: { modelCatalog }, commands: { refreshModelCatalog } } },
    contributions: { headerActions: { register: (value: PluginHeaderAction) => { header = value; } },
      commands: { register: (value: PluginCommand) => { command = value; } } },
    services: { maintenance: { requestConnectionTest, requestBackup }, diagnostics: { requestReport, verifyProjections },
      ui: { publishView }, logging: { write: mock(async () => ({ status: "accepted" })) } },
  } as unknown as PluginContext;
  return { ctx, connection, backup, report, verification, requestConnectionTest, requestBackup, requestReport, verifyProjections,
    modelCatalog, refreshModelCatalog, publishView, header: () => header, command: () => command };
}
afterEach(() => { plugin.deactivate(); });

describe("public API composition", () => {
  test("opening or reviewing never starts host effects; the receipt survives modal closure", async () => {
    const f = fixture();
    plugin.activate(f.ctx);
    expect(f.header().surface).toBe("shelf");
    const home = view(await f.command().run());
    const review = await select(home, "connection");
    expect(f.requestConnectionTest).not.toHaveBeenCalled();
    expect(f.modelCatalog).not.toHaveBeenCalled();
    expect(f.requestBackup).not.toHaveBeenCalled();
    expect(f.requestReport).not.toHaveBeenCalled();
    expect(f.verifyProjections).not.toHaveBeenCalled();
    expect(await action(review, "continue").run()).toEqual({ close: true });
    expect(f.requestConnectionTest).toHaveBeenCalledTimes(1);
    const history = await select(view(await f.command().run()), "results");
    const subscription = await history.live!.subscribe({ id: "history" });
    expect(JSON.stringify(history)).toContain("Awaiting host result");
    subscription.dispose();
    expect(f.requestConnectionTest.mock.calls[0]![0].signal.aborted).toBe(false);
    f.connection.resolve({ action: "test", status: "responded" });
    await tick();
    expect(JSON.stringify(await select(view(await f.command().run()), "results"))).toContain("Non-empty test response");
  });

  test.each(["backupExport", "backupImport", "reportExport", "reportSend"] as const)("%s uses the native request and retains only its receipt", async operation => {
    const f = fixture(); plugin.activate(f.ctx);
    const review = await select(view(await f.command().run()), operation);
    expect(await action(review, "continue").run()).toEqual({ close: true });
    const backup = operation.startsWith("backup"), chosen = operation.endsWith("Export") ? "export" : backup ? "import" : "send";
    expect((backup ? f.requestBackup : f.requestReport).mock.calls[0]![0]).toBe(chosen);
    const raw = { action: chosen, status: chosen === "export" ? "exported" : chosen === "import" ? "imported" : "sent", path: "/private/not-for-plugin", secret: "not-for-plugin" };
    if (backup) f.backup.resolve(raw as Awaited<typeof f.backup.promise>);
    else f.report.resolve(raw as Awaited<typeof f.report.promise>);
    await tick();
    const result = JSON.stringify(await select(view(await f.command().run()), "results"));
    expect(result).not.toContain("not-for-plugin");
    expect(result).toContain(chosen === "export" ? "Exported" : chosen === "import" ? "Imported" : "acknowledged");
  });

  test("projection check stays in a live view, reports drift counts, and never repairs", async () => {
    const f = fixture(); plugin.activate(f.ctx);
    const review = await select(view(await f.command().run()), "verify");
    const history = view(await action(review, "continue").run());
    const subscription = await history.live!.subscribe({ id: "verification" });
    f.verification.resolve({ consistent: false, eventsReplayed: 123, driftedTables: 1, onlyLiveRows: 2, onlyReplayedRows: 3 });
    await tick();
    const publication = JSON.stringify(f.publishView.mock.calls[f.publishView.mock.calls.length - 1]![1]);
    expect(publication).toContain("Projection differences found");
    expect(publication).toContain("123");
    subscription.dispose();
  });

  test("cancel retains the busy wait until settlement, ignores late success, and retirement aborts", async () => {
    const f = fixture(); plugin.activate(f.ctx);
    const home = view(await f.command().run());
    await action(await select(home, "connection"), "continue").run();
    const history = await select(home, "results");
    if (history.kind !== "detail") throw Error("Expected detail");
    const progress = history.content.find(block => block.kind === "progress");
    if (progress?.kind !== "progress") throw Error("Expected progress");
    await progress.cancel!.run();
    expect(f.requestConnectionTest.mock.calls[0]![0].signal.aborted).toBe(true);
    expect(await action(await select(home, "backupExport"), "continue").run()).toMatchObject({ toast: expect.any(String) });
    expect(f.requestBackup).not.toHaveBeenCalled();
    f.connection.resolve({ action: "test", status: "responded" });
    await tick();
    expect(JSON.stringify(await select(home, "results"))).toContain("started operations may continue");
    expect(JSON.stringify(await select(home, "results"))).not.toContain("Non-empty test response");
    await action(await select(home, "backupExport"), "continue").run();
    plugin.deactivate();
    expect(f.requestBackup.mock.calls[0]![1].signal.aborted).toBe(true);
    f.backup.resolve({ action: "export", status: "exported" });
    await tick();
  });

  test("host errors become stable error blocks, not empty or raw messages", async () => {
    const f = fixture(); plugin.activate(f.ctx);
    const home = view(await f.command().run());
    await action(await select(home, "connection"), "continue").run();
    f.connection.reject(Object.assign(Error("private endpoint and response"), { code: "ai/provider" }));
    await tick();
    const history = JSON.stringify(await select(home, "results"));
    expect(history).toContain('"code":"ai/provider"');
    expect(history).not.toContain("private endpoint");
    expect(history).not.toContain("No operations");
  });
});

describe("catalog consumer", () => {
  async function browse(f: ReturnType<typeof fixture>, search = "model") {
    const form = catalogViews(f.ctx, new AbortController().signal).form();
    if (form.kind !== "form") throw Error("Expected form");
    return view(await form.onSubmit({ provider: "openai", search }));
  }
  test("query has no refresh effect; next page carries the same filter and revision", async () => {
    const f = fixture(), page = await browse(f);
    expect(f.modelCatalog.mock.calls[0]![0]).toEqual({ provider: "openai", search: "model", limit: 25 });
    expect(f.refreshModelCatalog).not.toHaveBeenCalled();
    if (page.kind !== "list") throw Error("Expected list");
    await page.pagination!.onNext!();
    expect(f.modelCatalog.mock.calls[1]![0]).toEqual({ provider: "openai", search: "model", limit: 25, offset: 25, revision: 7 });
    const detail = await select(page, model.id);
    expect(JSON.stringify(detail)).toContain("100000");
    expect(JSON.stringify(detail)).toContain("image");
    await action(page, "refresh").run();
    expect(f.refreshModelCatalog).toHaveBeenCalledTimes(1);
    expect(f.modelCatalog.mock.calls[f.modelCatalog.mock.calls.length - 1]![0]).toEqual({ provider: "openai", search: "model", limit: 25 });
  });
  test("stale pages show an error and restart from a new revision", async () => {
    const f = fixture(), page = await browse(f);
    f.modelCatalog.mockRejectedValueOnce({ code: "settings/options-stale", message: "raw" });
    if (page.kind !== "list") throw Error("Expected list");
    const failed = view(await page.pagination!.onNext!());
    expect(JSON.stringify(failed)).toContain("settings/options-stale");
    await action(failed, "reload").run();
    expect(f.modelCatalog.mock.calls[f.modelCatalog.mock.calls.length - 1]![0]).not.toHaveProperty("revision");
  });
  test("refresh failure is surfaced while old cached rows can still be inspected", async () => {
    const f = fixture(), page = await browse(f);
    f.refreshModelCatalog.mockRejectedValueOnce({ code: "network/offline", message: "raw" });
    const failed = view(await action(page, "refresh").run());
    expect(JSON.stringify(failed)).toContain("network/offline");
    expect(view(await action(failed, "reload").run()).kind).toBe("list");
    f.modelCatalog.mockResolvedValueOnce({ ...catalogPage, models: [], errorCode: "network/offline" });
    const emptyFailure = await browse(f);
    expect(emptyFailure.kind).toBe("detail");
    expect(JSON.stringify(emptyFailure)).not.toContain("No matching models");
  });
  test("invalid filters do not query and providers are catalog choices, not current settings", async () => {
    const f = fixture(), form = catalogViews(f.ctx, new AbortController().signal).form();
    if (form.kind !== "form") throw Error("Expected form");
    expect(await form.onSubmit({ provider: "custom", search: "" })).toHaveProperty("fieldErrors.provider");
    expect(await form.onSubmit({ provider: "openai", search: "a".repeat(121) })).toHaveProperty("fieldErrors.search");
    expect(f.modelCatalog).not.toHaveBeenCalled();
  });
});

test("operation journal is bounded, clears finished rows, and rejects stale cancellation handles", async () => {
  const journal = new Operations();
  for (let i = 0; i < 25; i++) { expect(journal.start("connection", async () => ({ status: "responded" }))).toBe(true); await tick(); }
  expect(journal.snapshot()).toHaveLength(20);
  const wait = deferred<Outcome>();
  journal.start("verify", () => wait.promise);
  journal.cancel(1);
  expect(journal.snapshot()[0]!.phase).toBe("pending");
  journal.clear();
  expect(journal.snapshot()).toHaveLength(1);
  journal.dispose();
  wait.resolve({ status: "consistent" });
  await tick();
  expect(journal.snapshot()).toHaveLength(0);
  expect(journal.start("verify", async () => ({ status: "consistent" }))).toBe(false);
});

test("built entry activates without host imports and completes a public receipt flow", async () => {
  const compiled = (await import(new URL("../dist/main.js", import.meta.url).href)).default as typeof plugin;
  const f = fixture();
  compiled.activate(f.ctx);
  try {
    const home = view(await f.command().run());
    expect(await action(await select(home, "connection"), "continue").run()).toEqual({ close: true });
    f.connection.resolve({ action: "test", status: "empty" });
    await tick();
    expect(JSON.stringify(await select(view(await f.command().run()), "results"))).toContain("Empty test response");
  } finally { compiled.deactivate(); }
});
