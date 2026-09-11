import { expect, test } from "bun:test";
import { AppError, type EntityDecision } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildAgentTools } from "./registry";
import { buildEntityTools } from "./entity-tools";
import type { RuntimeDeps } from "../ports";
import type { ThreadScope } from "../thread-scope";

const scope: ThreadScope = { kind: "global", threadId: "entities" };
const revision = async (deps: RuntimeDeps) => (await deps.entityRegistry.query()).revision;
async function seed(deps: RuntimeDeps, entityId: string, name = entityId) {
  return deps.entityRegistry.decide({ op: "resolve", entityId, kind: "person", canonicalName: name, expectedRevision: await revision(deps) });
}
const parsed = (result: Awaited<ReturnType<ReturnType<typeof buildEntityTools>[number]["execute"]>>) => JSON.parse((result.content[0] as { text: string }).text);

test("both scopes expose read and sequential decision tools even with automatic memory building disabled", async () => {
  for (const current of [scope, { kind: "book", bookId: "b" }] as ThreadScope[]) {
    const { deps } = createInMemoryDeps(); deps.memoryPolicy = { enabled: () => false, subscribe: () => () => {} };
    expect(deps.memoryPolicy.enabled()).toBe(false);
    const tools = buildAgentTools(current, deps);
    expect(tools.find(tool => tool.name === "manage_entity")?.executionMode).toBe("sequential");
    const query = tools.find(tool => tool.name === "query_entities")!;
    expect(parsed(await query.execute("read", { kind: "identities" }))).toMatchObject({ total: 0 });
    expect((query.parameters as { type?: string }).type).toBe("object");
  }
});

test("resolve approval contains the frozen exact original-member candidate and records response details", async () => {
  for (const current of [scope, { kind: "book", bookId: "b" }] as ThreadScope[]) {
    const { deps } = createInMemoryDeps();
    const input: EntityDecision = { op: "resolve", entityId: "a", kind: "person", canonicalName: "Alice", aliases: ["A"], expectedRevision: await revision(deps) };
    const frozen = structuredClone(input), updates: unknown[] = [];
    deps.interactions.request = async request => {
      expect(request).toMatchObject({ kind: "permission", action: "manage-entity" });
      if (request.kind !== "permission") throw Error("Expected permission");
      expect(JSON.parse(request.subject)).toEqual({ current: [{ entityId: "a", canonicalId: null, canonicalDefinition: null, memberCount: 0 }], proposed: frozen });
      input.aliases![0] = "Injected"; input.canonicalName = "Changed";
      return { optionId: "approve" };
    };
    const result = await buildEntityTools(current, deps)[1]!.execute("resolve", input, undefined, update => updates.push(update));
    expect(parsed(result)).toMatchObject({ entityId: "a", canonicalId: "a", changed: true });
    expect(result.details).toMatchObject({ type: "user-interaction", phase: "response", answer: { optionId: "approve" } });
    expect(updates).toHaveLength(2);
    expect((await deps.entityRegistry.query({ kind: "members", entityId: "a" })).canonicalDefinition?.canonicalName).toBe("Alice");
  }
});

test("merge inspects two revision-pinned classes, displays keeper identity and preserves original definitions", async () => {
  const { deps } = createInMemoryDeps(); await seed(deps, "a", "Original"); await seed(deps, "b", "Keeper");
  const input: EntityDecision = { op: "merge", keepId: "b", mergedId: "a", expectedRevision: await revision(deps) };
  let asks = 0;
  deps.interactions.request = async request => {
    asks++; if (request.kind !== "permission") throw Error("Expected permission");
    const approval = JSON.parse(request.subject);
    expect(approval.current).toEqual([
      { entityId: "b", canonicalId: "b", canonicalDefinition: { kind: "person", canonicalName: "Keeper" }, memberCount: 1 },
      { entityId: "a", canonicalId: "a", canonicalDefinition: { kind: "person", canonicalName: "Original" }, memberCount: 1 },
    ]);
    expect(approval.proposed).toEqual(input); return { optionId: "approve" };
  };
  const decide = buildEntityTools(scope, deps)[1]!;
  expect(parsed(await decide.execute("merge", input))).toMatchObject({ canonicalId: "b", changed: true });
  expect((await deps.entityRegistry.query({ kind: "members", entityId: "a" })).items).toEqual([
    { id: "a", definition: { kind: "person", canonicalName: "Original" } }, { id: "b", definition: { kind: "person", canonicalName: "Keeper" } },
  ]);
  expect(asks).toBe(1);
});

test("decline, cancellation and invalid/self-authorized decisions never write", async () => {
  const { deps } = createInMemoryDeps(); let writes = 0, asks = 0;
  const original = deps.entityRegistry.decide;
  deps.entityRegistry.decide = (...args) => { writes++; return original(...args); };
  const tool = buildEntityTools(scope, deps)[1]!;
  const input = { op: "resolve", entityId: "a", kind: "person", canonicalName: "A", expectedRevision: await revision(deps) };
  for (const answer of [{ optionId: "decline" }, { cancelled: true }, { optionId: "unknown" }]) {
    deps.interactions.request = async () => { asks++; return answer; };
    expect(parsed(await tool.execute("declined", input))).toEqual({ changed: false });
  }
  for (const invalid of [{ ...input, confirmed: true }, { ...input, keepId: "a" }, { ...input, aliases: [""] }, { ...input, expectedRevision: "invalid" }]) {
    await expect(tool.execute("invalid", invalid)).rejects.toMatchObject({ code: "memory/invalid-input" });
  }
  await expect(tool.execute("pre-abort", input, AbortSignal.abort())).rejects.toBeDefined();
  const controller = new AbortController();
  deps.interactions.request = async () => { controller.abort(); return { optionId: "approve" }; };
  await expect(tool.execute("abort-at-approval", input, controller.signal)).rejects.toBeDefined();
  expect(writes).toBe(0); expect(asks).toBe(3);
});

test("unknown/pending merge targets and stale pre-approval versions never ask for approval", async () => {
  const { deps } = createInMemoryDeps(); await seed(deps, "a");
  let asks = 0; deps.interactions.request = async () => { asks++; return { optionId: "approve" }; };
  const tool = buildEntityTools(scope, deps)[1]!, old = await revision(deps);
  await expect(tool.execute("unknown", { op: "merge", keepId: "a", mergedId: "missing", expectedRevision: old })).rejects.toMatchObject({ code: "memory/not-found" });
  await seed(deps, "b");
  await expect(tool.execute("stale", { op: "merge", keepId: "a", mergedId: "b", expectedRevision: old })).rejects.toMatchObject({ code: "memory/conflict" });
  const query = deps.entityRegistry.query;
  deps.entityRegistry.query = async (...args) => ({ ...await query(...args), canonicalDefinition: null });
  await expect(tool.execute("pending", { op: "merge", keepId: "a", mergedId: "b", expectedRevision: await revision(deps) })).rejects.toMatchObject({ code: "memory/not-found" });
  expect(asks).toBe(0);
});

test("changes between class inspections or after approval conflict without retry; native failure remains visible", async () => {
  for (const when of ["between", "approved", "failure"] as const) {
    const { deps } = createInMemoryDeps(); await seed(deps, "a"); await seed(deps, "b");
    const input = { op: "merge", keepId: "a", mergedId: "b", expectedRevision: await revision(deps) };
    let queries = 0, asks = 0, writes = 0;
    const query = deps.entityRegistry.query, decide = deps.entityRegistry.decide;
    deps.entityRegistry.query = async (...args) => {
      const result = await query(...args); queries++;
      if (when === "between" && queries === 1) await decide({ op: "resolve", entityId: "c", kind: "person", canonicalName: "C", expectedRevision: result.revision });
      return result;
    };
    deps.interactions.request = async () => {
      asks++;
      if (when === "approved") await decide({ op: "resolve", entityId: "c", kind: "person", canonicalName: "C", expectedRevision: input.expectedRevision });
      return { optionId: "approve" };
    };
    deps.entityRegistry.decide = async (...args) => { writes++; if (when === "failure") throw new AppError("db/locked", "Native failure"); return decide(...args); };
    await expect(buildEntityTools(scope, deps)[1]!.execute("race", input)).rejects.toMatchObject({ code: when === "failure" ? "db/locked" : "memory/conflict" });
    expect(asks).toBe(when === "between" ? 0 : 1); expect(writes).toBe(when === "between" ? 0 : 1);
  }
});

test("entity reads page originals/aliases without writes, enforce input boundaries and reject cancelled late results", async () => {
  const { deps } = createInMemoryDeps(); await seed(deps, "a"); await seed(deps, "b");
  const tool = buildEntityTools(scope, deps)[0]!;
  const first = parsed(await tool.execute("read", { kind: "identities", limit: 1 }));
  expect(first.nextOffset).toBe(1);
  expect(parsed(await tool.execute("next", { kind: "identities", offset: 1, expectedRevision: first.revision })).items).toHaveLength(1);
  expect(parsed(await tool.execute("alias", { kind: "aliases", entityId: "a" })).items).toEqual([{ entityId: "a", alias: "a" }]);
  for (const input of [{ kind: "identities", bookId: "other" }, { kind: "members" }, { kind: "aliases", entityId: "a", search: "x" }, { kind: "identities", limit: 101 }]) {
    await expect(tool.execute("invalid", input)).rejects.toMatchObject({ code: "memory/invalid-query" });
  }
  const controller = new AbortController(), query = deps.entityRegistry.query;
  deps.entityRegistry.query = async (...args) => { const page = await query(...args); controller.abort(); return page; };
  await expect(tool.execute("late", { kind: "identities" }, controller.signal)).rejects.toBeDefined();
});
