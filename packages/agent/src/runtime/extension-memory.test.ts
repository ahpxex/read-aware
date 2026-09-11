import { expect, test } from "bun:test";
import { AppError, type MemoryCandidateOutcome } from "@read-aware/core";
import { createInMemoryDeps, seedMemory } from "../testing/fixtures";
import { memoryPolicyState } from "../testing/memory-policy";
import { runMemoryBuild } from "../memory/build-policy";
import type { ExternalMemoryCandidate, RuntimeDeps } from "../ports";
import { persistExtensionMemory } from "./extension-memory";

function candidate(content: string, extra: Partial<ExternalMemoryCandidate> = {}) {
  const outcomes: MemoryCandidateOutcome[] = [];
  return { value: { content, kind: "fact", scope: "user", ...extra, report: outcome => outcomes.push(outcome) } as ExternalMemoryCandidate, outcomes };
}
function run(deps: RuntimeDeps, candidates: ExternalMemoryCandidate[], existing = [] as ReturnType<typeof seedMemory>[]) {
  return runMemoryBuild(deps, operation => persistExtensionMemory({ scope: { kind: "global", threadId: "test" },
    sourceThreadKey: "global:test", candidates, existing, memory: deps.memory, operation, log: deps.log }));
}

test("reports host decisions for invalid, wrong-scope, duplicate, saved and over-budget proposals", async () => {
  const { deps, stores } = createInMemoryDeps();
  const cases = [candidate(" "), candidate("scope", { scope: "book:elsewhere" }), candidate("known"),
    candidate("new"), candidate("new"), candidate("another"), candidate("over budget")];
  await run(deps, cases.map(item => item.value), [seedMemory({ id: "existing", scope: "user", content: "KNOWN" })]);
  expect(cases.map(item => item.outcomes)).toEqual([
    [{ status: "rejected", reason: "invalid" }], [{ status: "rejected", reason: "scope" }],
    [{ status: "rejected", reason: "duplicate" }], [{ status: "saved" }],
    [{ status: "rejected", reason: "duplicate" }], [{ status: "saved" }], [{ status: "rejected", reason: "limit" }],
  ]);
  expect(stores.savedMemoryInputs.map(item => item.content)).toEqual(["new", "another"]);
  expect(stores.savedMemoryInputs[0]).not.toHaveProperty("report");
  expect(stores.savedMemoryInputs[0]).not.toHaveProperty("available");
});

test("a real write failure is not rejection or success; later writes are not attempted", async () => {
  const { deps } = createInMemoryDeps(), first = candidate("first"), second = candidate("second");
  deps.memory.saveMemory = async () => { throw new AppError("db/locked", "private cause"); };
  await expect(run(deps, [first.value, second.value])).rejects.toMatchObject({ code: "db/locked" });
  expect(first.outcomes).toEqual([{ status: "failed", errorCode: "db/locked" }]);
  expect(second.outcomes).toEqual([{ status: "skipped", reason: "prior-failure" }]);
});

test("revocation during a dispatched write reports its actual success and skips subsequent candidates", async () => {
  const { deps, stores } = createInMemoryDeps(), policy = memoryPolicyState(); deps.memoryPolicy = policy.policy;
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const save = deps.memory.saveMemory;
  deps.memory.saveMemory = async input => { enter(); await hold; return save(input); };
  const first = candidate("first"), second = candidate("second");
  const pending = run(deps, [first.value, second.value]);
  const result = pending.catch(error => error);
  await entered; policy.set(false);
  expect(first.outcomes).toEqual([]);
  release(); expect(await result).toMatchObject({ code: "ai/memory-disabled" }); await Promise.resolve();
  expect(first.outcomes).toEqual([{ status: "saved" }]);
  expect(second.outcomes).toEqual([{ status: "skipped", reason: "cancelled" }]);
  expect(stores.savedMemoryInputs).toHaveLength(1);
});

test("retired providers cannot save and failing delivery cannot undo a successful write", async () => {
  const { deps, stores } = createInMemoryDeps(), gone = candidate("gone", { available: () => false });
  const warnings: unknown[] = []; deps.log = { warn: (...args) => { warnings.push(args); } } as RuntimeDeps["log"];
  const okay = candidate("okay"); okay.value.report = () => { throw Error("delivery failed"); };
  await run(deps, [gone.value, okay.value]);
  expect(gone.outcomes).toEqual([{ status: "skipped", reason: "provider-unavailable" }]);
  expect(stores.savedMemoryInputs.map(item => item.content)).toEqual(["okay"]);
  expect(warnings).toHaveLength(1);
});
