import { expect, test } from "bun:test";
import { AppError } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { createInMemoryDeps, seedMemory } from "../testing/fixtures";
import { memoryPolicyState } from "../testing/memory-policy";
import { runMemoryBuild } from "./build-policy";

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));
const digest = { chapterIndex: 0, summary: "Committed", characters: [], relations: [], digestVersion: 2 };
type Destination = "memory" | "reinforce" | "consolidate" | "profile" | "insights" | "digest" | "classification";

for (const destination of ["memory", "reinforce", "consolidate", "profile", "insights", "digest", "classification"] as const) {
  test(`cancelled ${destination} waits for its dispatched write receipt and refuses subsequent writes`, async () => {
    const state = memoryPolicyState(), { deps } = createInMemoryDeps(); deps.memoryPolicy = state.policy;
    const started = deferred(), release = deferred(); let writes = 0;
    const hold = async () => { started.resolve(); await release.promise; writes++; };
    const memory = seedMemory({ id: "m", scope: "user", content: "Committed" });
    const snapshot = { memory, revision: `mem1:${"0".repeat(64)}` };
    deps.memory.saveMemory = async () => { await hold(); return memory; };
    deps.memory.reinforceMemory = async () => { await hold(); };
    deps.memory.applyMemoryChanges = async () => { await hold(); return []; };
    deps.profile.putProfileSummary = hold;
    deps.conversations.putInsights = hold;
    deps.bookMemory.saveDigest = hold;
    deps.library.classifyBookIfUnclassified = async () => { await hold(); return "narrative"; };
    const call = (port: RuntimeDeps, target: Destination) => {
      if (target === "memory") return port.memory.saveMemory({ scope: "user", kind: "fact", content: "Committed", origin: "agent", sourceThreadKey: "global" });
      if (target === "reinforce") return port.memory.reinforceMemory(snapshot);
      if (target === "consolidate") return port.memory.applyMemoryChanges([], []);
      if (target === "profile") return port.profile.putProfileSummary("Committed");
      if (target === "insights") return port.conversations.putInsights("global", "Committed");
      if (target === "digest") return port.bookMemory.saveDigest("b", digest, `bdg1:${"0".repeat(64)}`);
      return port.library.classifyBookIfUnclassified("b", "narrative");
    };
    let protectedDeps = deps, terminal = false;
    const pending = runMemoryBuild(deps, async operation => { protectedDeps = operation.protect(deps); await call(protectedDeps, destination); });
    const observed = pending.then(() => { terminal = true; return null; }, error => { terminal = true; return error; });
    await started.promise; state.set(false); await nextTurn();
    expect(terminal).toBe(false); expect(writes).toBe(0); expect(state.count()).toBe(1);
    state.set(true);
    await expect(call(protectedDeps, destination)).rejects.toMatchObject({ code: "ai/memory-disabled" });
    release.resolve();
    expect(await observed).toMatchObject({ code: "ai/memory-disabled" });
    expect(writes).toBe(1); expect(state.count()).toBe(0);
  });
}

test("cancellation drains every dispatched commit and logs a late storage failure without unhandled rejection", async () => {
  const state = memoryPolicyState(), first = deferred(), second = deferred(); const warnings: unknown[] = [];
  let terminal = false;
  const pending = runMemoryBuild({ memoryPolicy: state.policy, log: { warn: (...args) => { warnings.push(args); }, error() {} } }, async operation => {
    await Promise.all([
      operation.commit(async () => { await first.promise; })(),
      operation.commit(async () => { await second.promise; throw new AppError("db/locked", "PRIVATE"); })(),
    ]);
  });
  const observed = pending.catch(error => { terminal = true; return error; });
  state.set(false); first.resolve(); await nextTurn();
  expect(terminal).toBe(false); expect(warnings).toHaveLength(0);
  second.resolve(); expect(await observed).toMatchObject({ code: "ai/memory-disabled" });
  expect(warnings).toHaveLength(1); expect(state.count()).toBe(0);
});

test("completed and failed operations cannot reuse captured guards or commit functions", async () => {
  for (const fail of [false, true]) for (const kind of ["guard", "commit"] as const) {
    let late!: () => Promise<void>, writes = 0;
    const result = runMemoryBuild({}, async operation => {
      late = operation[kind](async () => { writes++; });
      if (fail) throw new AppError("db/error", "Failed operation");
    });
    if (fail) await expect(result).rejects.toMatchObject({ code: "db/error" }); else await result;
    await expect(late()).rejects.toMatchObject({ code: "memory/cancelled" }); expect(writes).toBe(0);
  }
});

test("caller cancellation drains a write while ordinary model/read cancellation remains prompt", async () => {
  const controller = new AbortController(), release = deferred(); let terminal = false;
  const pending = runMemoryBuild({}, operation => operation.commit(async () => { await release.promise; })(), controller.signal);
  const observed = pending.catch(error => { terminal = true; return error; });
  controller.abort(new AppError("memory/cancelled", "Task cancelled")); await nextTurn();
  expect(terminal).toBe(false); release.resolve();
  expect(await observed).toMatchObject({ code: "memory/cancelled" });
  const other = new AbortController();
  const read = runMemoryBuild({}, operation => operation.guard(async () => new Promise<void>(() => {}))(), other.signal);
  other.abort(); await expect(read).rejects.toBeDefined();
});
