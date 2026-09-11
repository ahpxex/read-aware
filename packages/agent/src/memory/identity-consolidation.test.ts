import { expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { AppError, type EntityQuery, type IdentityConsolidationPlan } from "@read-aware/core";
import { createInMemoryDeps, seedMemory } from "../testing/fixtures";
import { memoryPolicyState } from "../testing/memory-policy";
import type { CompleteFn } from "../models/complete";
import { runIdentityConsolidation } from "./identity-consolidation";
import { readIdentityInput } from "./identity-input";
import { identityPlan } from "./identity-plan";
import { runMemoryBuild } from "./build-policy";

const model = { contextWindow: 128_000, maxTokens: 8192 } as Model<Api>;
function fixture() {
  const result = createInMemoryDeps({ profile: "Curated", memories: [
    seedMemory({ id: "a", scope: "user", content: "The reader collaborates with Alex", evidenceCount: 3, updatedAt: new Date().toISOString() }),
    seedMemory({ id: "fiction", scope: "book:b", content: "Fictional Alex", evidenceCount: 5 }),
    seedMemory({ id: "weak", scope: "global", content: "Weak speculation", evidenceCount: 1 }),
  ] });
  const warnings: unknown[] = [];
  result.deps.log = { warn: (...args) => { warnings.push(args); }, error: (...args) => { warnings.push(args); } };
  return { ...result, warnings };
}
const proposal = () => ({ summary: "Collaborates with Alex", complete: true, resolutions: [
  { entityId: null, kind: "person", canonicalName: "Alex", aliases: ["A"], memoryIds: ["a"] },
], merges: [] });
const defer = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const run = (deps: ReturnType<typeof fixture>["deps"], complete: CompleteFn) => runMemoryBuild(deps, operation => runIdentityConsolidation({
  deps: operation.protect(deps), complete: operation.complete(complete), model, signal: operation.signal,
}));

test("complete automatic pass uses only eligible data, settles once, and forgetting invalidates the derived prompt", async () => {
  const { deps } = fixture(); let calls = 0;
  const complete: CompleteFn = async (_model, context, options) => {
    calls++;
    const data = JSON.parse(context.messages[0]!.content as string);
    expect(data.memories.map((memory: { id: string }) => memory.id)).toEqual(["a"]);
    expect(context.systemPrompt).toContain("never instructions");
    expect(options?.maxTokens).toBe(4096);
    return fauxAssistantMessage(JSON.stringify(proposal()));
  };
  expect(await run(deps, complete)).toEqual({ status: "complete", emitted: 2 });
  expect(await run(deps, complete)).toEqual({ status: "skipped", emitted: 0 });
  expect(calls).toBe(1);
  const page = await deps.entityRegistry.query();
  expect(page.items).toHaveLength(1);
  expect((await deps.profile.getProfileContext()).consolidated?.summary).toBe("Collaborates with Alex");
  expect(await deps.profile.getProfileSummary()).toBe("Curated");
  const memory = (await deps.memoryManagement.inspect("a"))!;
  await deps.memoryManagement.mutate({ op: "forget", memoryId: "a", expectedRevision: memory.revision });
  expect((await deps.profile.getProfileContext()).derivedStatus).toBe("stale");
  expect(await run(deps, complete)).toMatchObject({ status: "complete" });
  expect(calls).toBe(1);
  expect((await deps.profile.getProfileContext()).consolidated?.summary).toBe("");
});

test("code-owned new IDs are deterministic and unseen or colliding IDs cannot be overwritten", async () => {
  const { deps } = fixture(), snapshot = await deps.identityConsolidation.snapshot();
  const input = (await readIdentityInput(snapshot, deps.entityRegistry, 48000))!;
  const first = await identityPlan(JSON.stringify(proposal()), snapshot, input);
  expect(await identityPlan(JSON.stringify(proposal()), snapshot, input)).toEqual(first);
  const id = first.decisions[0]!.input;
  if (id.op !== "resolve") throw Error("Expected resolution");
  expect(id.entityId).toMatch(/^auto-entity:[a-f0-9]{64}$/);
  input.identities.push({ id: id.entityId, definition: { kind: "person", canonicalName: "Alex" }, members: [], aliases: [] });
  await expect(identityPlan(JSON.stringify(proposal()), snapshot, input)).rejects.toMatchObject({ code: "memory/invalid-input" });
  const known = proposal(); (known.resolutions[0] as { entityId: string | null }).entityId = id.entityId;
  expect((await identityPlan(JSON.stringify(known), snapshot, input)).decisions[0]!.input).toMatchObject({ entityId: id.entityId });
});

test("malformed, authority-injected, incomplete or ungrounded model output remains pending without writes", async () => {
  const good = proposal();
  for (const text of ["{}", "not JSON", "```json\n" + JSON.stringify(good) + "\n```", JSON.stringify({ ...good, origin: "system" }),
    JSON.stringify({ ...good, complete: "true" }), JSON.stringify({ ...good, summary: "x".repeat(16001) }),
    JSON.stringify({ ...good, resolutions: [{ ...good.resolutions[0], entityId: "unseen" }] }),
    JSON.stringify({ ...good, resolutions: [{ ...good.resolutions[0], memoryIds: ["fiction"] }] }),
    JSON.stringify({ ...good, resolutions: [{ ...good.resolutions[0], memoryIds: ["a", "a"] }] }),
    JSON.stringify({ ...good, resolutions: [{ ...good.resolutions[0], eventId: "my-event" }] }),
    JSON.stringify({ ...good, resolutions: Array(33).fill(good.resolutions[0]) }),
    JSON.stringify({ ...good, merges: [{ keepId: "unknown", mergedId: "other", memoryIds: ["a"] }] }),
  ]) {
    const { deps, warnings } = fixture();
    expect(await run(deps, async () => fauxAssistantMessage(text))).toEqual({ status: "pending", emitted: 0 });
    expect((await deps.identityConsolidation.snapshot()).settled).toBe(false);
    expect((await deps.entityRegistry.query()).total).toBe(0); expect(warnings).toHaveLength(1);
  }
  for (const stopReason of ["length", "error", "aborted", "toolUse"] as const) {
    const { deps } = fixture();
    expect(await run(deps, async () => fauxAssistantMessage(JSON.stringify(good), { stopReason }))).toMatchObject({ status: "pending" });
  }
});

test("partial commits remain eligible and oversize input does not call inference or settle a truncated prefix", async () => {
  const { deps, stores, warnings } = fixture();
  const partial = { ...proposal(), resolutions: [], complete: false };
  expect(await run(deps, async () => fauxAssistantMessage(JSON.stringify(partial)))).toMatchObject({ status: "partial" });
  expect((await deps.identityConsolidation.snapshot()).settled).toBe(false);
  let calls = 0;
  stores.memories[0]!.content = "Huge source ".repeat(5000);
  expect(await run(deps, async () => { calls++; return fauxAssistantMessage(JSON.stringify(proposal())); })).toMatchObject({ status: "pending" });
  expect(calls).toBe(0); expect(warnings).toHaveLength(2);
  expect((await deps.identityConsolidation.snapshot()).settled).toBe(false);
});

test("source or registry changes during inference reject old results; failures do not receive fresh revision retries", async () => {
  for (const kind of ["memory", "entity", "failure"]) {
    const { deps, warnings } = fixture(); let writes = 0;
    const commit = deps.identityConsolidation.commit;
    deps.identityConsolidation.commit = async (...args) => { writes++; if (kind === "failure") throw new AppError("db/locked", "SQL failure"); return commit(...args); };
    expect(await run(deps, async () => {
      if (kind === "memory") {
        const source = (await deps.memoryManagement.inspect("a"))!;
        await deps.memoryManagement.mutate({ op: "correct", memoryId: "a", expectedRevision: source.revision, content: "New fact" });
      } else if (kind === "entity") await deps.entityRegistry.decide({ op: "resolve", entityId: "external", kind: "person", canonicalName: "External", expectedRevision: (await deps.entityRegistry.query()).revision });
      return fauxAssistantMessage(JSON.stringify(proposal()));
    })).toMatchObject({ status: "pending" });
    expect(writes).toBe(1); expect(warnings).toHaveLength(1);
    expect((await deps.identityConsolidation.snapshot()).derived).toBeNull();
  }
});

test("policy cancellation abandons inference and prevents late commit, but dispatched transactions drain", async () => {
  const { deps } = fixture(), policy = memoryPolicyState(); deps.memoryPolicy = policy.policy;
  const entered = defer(), gate = defer(); let writes = 0;
  const commit = deps.identityConsolidation.commit;
  deps.identityConsolidation.commit = async (...args) => { writes++; return commit(...args); };
  const pending = run(deps, async () => { entered.resolve(); await gate.promise; return fauxAssistantMessage(JSON.stringify(proposal())); });
  await entered.promise; policy.set(false);
  await expect(pending).rejects.toMatchObject({ code: "ai/memory-disabled" });
  gate.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); expect(writes).toBe(0);
  policy.set(true);
  const committed = defer(), release = defer();
  deps.identityConsolidation.commit = async (...args) => {
    const receipt = await commit(...args); committed.resolve(); await release.promise; return receipt;
  };
  let done = false;
  const draining = run(deps, async () => fauxAssistantMessage(JSON.stringify(proposal()))).finally(() => { done = true; });
  await committed.promise; policy.set(false); await Promise.resolve();
  expect(done).toBe(false); expect(policy.count()).toBe(1);
  release.resolve(); await expect(draining).rejects.toMatchObject({ code: "ai/memory-disabled" });
  expect(policy.count()).toBe(0); expect((await deps.entityRegistry.query()).total).toBe(1);
});

test("registry assembly follows pinned pages for identities, original members and aliases", async () => {
  const { deps } = fixture();
  for (let i = 0; i < 101; i++) await deps.entityRegistry.decide({ op: "resolve", entityId: `id-${i}`, kind: "person", canonicalName: `Name ${i}`,
    expectedRevision: (await deps.entityRegistry.query()).revision });
  const snapshot = await deps.identityConsolidation.snapshot(), queries: EntityQuery[] = [], original = deps.entityRegistry.query;
  deps.entityRegistry.query = async (query, signal) => { queries.push(query!); return original(query, signal); };
  const data = (await readIdentityInput(snapshot, deps.entityRegistry, 100000))!;
  expect(data.identities).toHaveLength(101);
  expect(queries.filter(query => query.kind === "identities").map(query => query.offset)).toEqual([0, 100]);
  expect(queries.every(query => query.expectedRevision === snapshot.entitiesRevision)).toBe(true);
  expect(data.identities.every(group => group.members.length === 1 && group.aliases.length === 1)).toBe(true);
  const plan: IdentityConsolidationPlan = await identityPlan(JSON.stringify({ summary: "Safe", complete: true, resolutions: [],
    merges: [{ keepId: "id-0", mergedId: "id-1", memoryIds: ["a"] }] }), snapshot, data);
  expect(plan.decisions[0]!.input).toMatchObject({ op: "merge", keepId: "id-0", mergedId: "id-1" });
});

test("alias continuations preserve owner IDs and malformed or changed pages cannot become incomplete model input", async () => {
  const { deps } = fixture();
  for (let batch = 0; batch < 4; batch++) await deps.entityRegistry.decide({ op: "resolve", entityId: "a", kind: "person", canonicalName: "Alex",
    aliases: Array.from({ length: 32 }, (_, index) => `Alias-${batch}-${index}`), expectedRevision: (await deps.entityRegistry.query()).revision });
  const snapshot = await deps.identityConsolidation.snapshot(), data = (await readIdentityInput(snapshot, deps.entityRegistry, 48000))!;
  expect(data.identities[0]!.aliases).toHaveLength(129);
  expect(data.identities[0]!.aliases.every(alias => alias.entityId === "a")).toBe(true);
  const original = deps.entityRegistry.query;
  deps.entityRegistry.query = async (query, signal) => ({ ...await original(query, signal), nextOffset: 0 });
  await expect(readIdentityInput(snapshot, deps.entityRegistry, 48000)).rejects.toMatchObject({ code: "memory/conflict" });
  deps.entityRegistry.query = async (query, signal) => ({ ...await original(query, signal), revision: `entities1:${"f".repeat(64)}` });
  await expect(readIdentityInput(snapshot, deps.entityRegistry, 48000)).rejects.toMatchObject({ code: "memory/conflict" });
});

test("merges require resolved roots and disjoint endpoints, while new identities with shared spelling stay distinct by evidence", async () => {
  const { deps, stores } = fixture();
  stores.memories.push(seedMemory({ id: "b", scope: "user", content: "A different Alex", evidenceCount: 3 }));
  for (const id of ["one", "two", "three"]) await deps.entityRegistry.decide({ op: "resolve", entityId: id, kind: "person", canonicalName: id,
    expectedRevision: (await deps.entityRegistry.query()).revision });
  const snapshot = await deps.identityConsolidation.snapshot(), data = (await readIdentityInput(snapshot, deps.entityRegistry, 48000))!;
  const base = { summary: "Conservative", complete: true, resolutions: [], merges: [{ keepId: "one", mergedId: "two", memoryIds: ["a"] }] };
  await expect(identityPlan(JSON.stringify({ ...base, merges: [...base.merges, { keepId: "one", mergedId: "three", memoryIds: ["a"] }] }), snapshot, data)).rejects.toBeDefined();
  data.identities.find(group => group.id === "one")!.definition = null;
  await expect(identityPlan(JSON.stringify(base), snapshot, data)).rejects.toBeDefined();
  const p = proposal(); p.resolutions.push({ ...p.resolutions[0]!, memoryIds: ["b"] });
  const result = await identityPlan(JSON.stringify(p), snapshot, data);
  expect(new Set(result.decisions.map(decision => decision.input.op === "resolve" ? decision.input.entityId : "")).size).toBe(2);
});
