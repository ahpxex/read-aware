import { expect, spyOn, test } from "bun:test";
import { AppError, type MemoryObservation, type ProfileInspectionQuery } from "@read-aware/core";
import { buildMemoryTools } from "../../../../packages/agent/src/tools/memory-tools";
import { createInMemoryDeps } from "@read-aware/agent/testing";
import * as domain from "./identity-consolidation";
import { createProfilePort } from "../features/ai/agent/ports/profile-port";
import { identityHost } from "../../tests/helpers/identity-host";
import { deferred } from "../../tests/helpers/entity-host";
import { MemoryObserver } from "./memory-observer";

test("production profile port and Agent inspection read the existing atomic context command, with no writes or source text", async () => {
  const host = identityHost();
  host.controls.snapshot.derived = { version: 1, summary: "Inferred", sources: [{ memoryId: "a", revision: host.controls.snapshot.sources[0]!.revision }], entityEvidence: [] };
  const spy = spyOn(domain, "inspectProfileContext").mockImplementation(host.service.inspect);
  try {
    const { deps } = createInMemoryDeps(); deps.profile = createProfilePort();
    const tool = buildMemoryTools({ kind: "global", threadId: "t" }, deps).find(tool => tool.name === "inspect_user_profile")!;
    const result = await tool.execute("read", {});
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ kind: "summary", text: "Inferred", derivedStatus: "current" });
    expect(host.calls).toEqual([{ command: "profile_context", args: undefined }]);
    expect(host.minted).toHaveLength(0); expect(host.broadcasts).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("Source");
    host.controls.beforeRead = async () => { throw new AppError("db/locked", "native details"); };
    await expect(tool.execute("failure", {})).rejects.toMatchObject({ code: "db/locked" });
  } finally { spy.mockRestore(); }
});

test("inspection captures queries before initialization, rejects invalid inputs before IPC and suppresses late reads", async () => {
  const host = identityHost(), entered = deferred(), gate = deferred();
  host.controls.beforeInitialize = () => { entered.resolve(); return gate.promise; };
  const query: ProfileInspectionQuery = { kind: "sources", limit: 1 };
  const pending = host.service.inspect(query); query.kind = "summary"; query.limit = 10;
  await entered.promise; gate.resolve(); expect(await pending).toMatchObject({ kind: "sources" });
  const calls = host.calls.length;
  await expect(host.service.inspect({ kind: "sources", limit: 101 })).rejects.toMatchObject({ code: "memory/invalid-query" });
  await expect(host.service.inspect({}, AbortSignal.abort())).rejects.toBeDefined();
  expect(host.calls).toHaveLength(calls);
  const readEntered = deferred(), readGate = deferred(), controller = new AbortController();
  host.controls.beforeRead = () => { readEntered.resolve(); return readGate.promise; };
  const late = host.service.inspect({}, controller.signal); await readEntered.promise;
  controller.abort(); readGate.resolve(); await expect(late).rejects.toBeDefined();
  host.controls.beforeRead = async () => {};
  host.controls.snapshot.derived = { summary: "Private invalid block" };
  expect(await host.service.inspect()).toMatchObject({ derivedStatus: "invalid", text: null });
  expect(host.warnings).toHaveLength(1);
});

test("profile context observation detects source invalidation, reports errors and recovers without mixing pinned pages", async () => {
  const host = identityHost(), tasks: (() => void)[] = [], errors: unknown[] = [], events: MemoryObservation[] = [];
  host.controls.snapshot.derived = { version: 1, summary: "Inferred", sources: [{ memoryId: "a", revision: host.controls.snapshot.sources[0]!.revision }], entityEvidence: [] };
  const observer = new MemoryObserver({ schedule: work => { tasks.push(work); return () => { const index = tasks.indexOf(work); if (index >= 0) tasks.splice(index, 1); }; }, report: error => { errors.push(error); } });
  const stop = observer.observe({ kind: "profileContext", query: { kind: "summary" } }, async query => {
    if (query.kind !== "profileContext") throw Error("Unexpected query");
    return { kind: query.kind, page: await host.service.inspect(query.query) };
  }, event => { events.push(event); });
  const flush = async () => { for (let i = 0; i < 100 && !tasks.length; i++) await Bun.sleep(1); expect(tasks).toHaveLength(1); };
  try {
    await flush(); expect(events.at(-1)).toMatchObject({ status: "ready", result: { page: { derivedStatus: "current" } } });
    host.controls.snapshot.sources = []; tasks.shift()!(); await flush();
    expect(events.at(-1)).toMatchObject({ status: "ready", result: { page: { derivedStatus: "stale" } } });
    host.controls.beforeRead = async () => { throw new AppError("db/locked", "private"); }; tasks.shift()!(); await flush();
    expect(events.at(-1)).toMatchObject({ status: "error", errorCode: "db/locked" }); expect(errors).toHaveLength(1);
    host.controls.beforeRead = async () => {}; host.controls.snapshot.derived = null; tasks.shift()!(); await flush();
    expect(events.at(-1)).toMatchObject({ status: "ready", result: { page: { derivedStatus: "absent" } } });
    expect(events.map(event => event.revision)).toEqual([1, 2, 3, 4]);
  } finally { stop(); }
  expect(tasks).toHaveLength(0);
});
