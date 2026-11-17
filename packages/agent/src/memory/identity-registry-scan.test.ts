import { expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { AppError, type EntityQuery } from "@read-aware/core";
import type { CompleteFn } from "../models/complete";
import { createInMemoryDeps, seedMemory } from "../testing/fixtures";
import { runIdentityConsolidation } from "./identity-consolidation";
import { identityBytes, readIdentityInput, type IdentityInput } from "./identity-input";
import { checkNewIdentityIds, identityPlan } from "./identity-plan";
import { partitionRefs, type RegistryPartition } from "./identity-registry-partitions";
import type { RegistrySelection } from "./identity-registry-scan";

const model = { contextWindow: 128000, maxTokens: 4096 } as Model<Api>;
const message = (value: unknown) => fauxAssistantMessage(JSON.stringify(value));
async function fixture() {
  const result = createInMemoryDeps({
    memories: [
      seedMemory({
        id: "source",
        scope: "user",
        evidenceCount: 3,
        content: "The reader works with Original Alex, also known as SignalAlias.",
      }),
    ],
  });
  result.deps.log = { warn() {}, error() {} };
  const registry = result.deps.entityRegistry;
  const define = async (entityId: string, canonicalName: string, aliases: string[] = []) =>
    registry.decide({
      op: "resolve",
      entityId,
      kind: "person",
      canonicalName,
      aliases,
      expectedRevision: (await registry.query()).revision,
    });
  for (let i = 0; i < 40; i++) await define(`other-${i}`, `Unrelated ${i} ` + "名".repeat(350));
  await define("keeper", "Keeper Alex");
  await define("zz-member", "Original Alex");
  for (let i = 0; i < 6; i++)
    await define(
      "zz-member",
      "Original Alex",
      Array.from({ length: 32 }, (_, n) => `alias-${i}-${n}-` + "字".repeat(400)),
    );
  await define("zz-member", "Original Alex", ["SignalAlias"]);
  await registry.decide({
    op: "merge",
    keepId: "keeper",
    mergedId: "zz-member",
    expectedRevision: (await registry.query()).revision,
  });
  for (let i = 0; i < 105; i++) {
    const id = `merged-${String(i).padStart(3, "0")}`;
    await define(id, `Historical member ${i}`);
    await registry.decide({
      op: "merge",
      keepId: "keeper",
      mergedId: id,
      expectedRevision: (await registry.query()).revision,
    });
  }
  return result;
}
type ScanData = { partition: RegistryPartition; prior: RegistrySelection; maxRefs: number };
function select(data: ScanData, hasMore = false) {
  const candidates = [
    ...data.prior.refs,
    ...partitionRefs(data.partition).filter((ref) => ref.entityId === "zz-member"),
  ];
  const refs = [...new Map(candidates.map((ref) => [ref.entityId, ref])).values()];
  return {
    summary: refs.length ? "Original member has explicit SignalAlias evidence; do not rename keeper." : "",
    refs,
    hasMore,
  };
}
function response(data: Record<string, unknown>, hasMore = false) {
  if (data.partition) return message(select(data as unknown as ScanData, hasMore));
  if (data.identities)
    return message({
      summary: "Supported profile",
      complete: true,
      resolutions: [
        {
          entityId: "zz-member",
          kind: "person",
          canonicalName: "Original Alex",
          aliases: ["Grounded alias"],
          memoryIds: ["source"],
        },
      ],
      merges: [],
    });
  return message({ summary: "The reader works with Original Alex, known as SignalAlias", memoryIds: ["source"] });
}
const run = (deps: Awaited<ReturnType<typeof fixture>>["deps"], complete: CompleteFn) =>
  runIdentityConsolidation({ deps, complete, model });

test("a large registry and an oversized class are fully partitioned and hydrated in one pass before conditional publication", async () => {
  const { deps } = await fixture(),
    snapshot = await deps.identityConsolidation.snapshot();
  expect(await readIdentityInput(snapshot, deps.entityRegistry, 48000)).toBeNull();
  const visited = new Set<string>(),
    aliasNames = new Set<string>(),
    queries: EntityQuery[] = [];
  const query = deps.entityRegistry.query;
  deps.entityRegistry.query = async (input, signal) => {
    if (input) queries.push(input);
    return query(input, signal);
  };
  let finalCalls = 0;
  const result = await run(deps, async (_model, context) => {
    const json = context.messages[0]!.content as string,
      data = JSON.parse(json);
    expect(identityBytes(json)).toBeLessThan(48000);
    if (data.partition) {
      const p = data.partition as RegistryPartition,
        key = `${p.root.id}:${p.kind}:${p.offset}`;
      expect(visited.has(key)).toBe(false);
      visited.add(key);
      for (const item of p.items) if ("alias" in item) aliasNames.add(item.alias);
    } else if (data.identities) {
      finalCalls++;
      expect(data.registryScan).toMatchObject({ hasMore: false });
      expect(data.identities).toEqual([
        {
          id: "keeper",
          definition: { kind: "person", canonicalName: "Keeper Alex" },
          members: [{ id: "zz-member", definition: { kind: "person", canonicalName: "Original Alex" } }],
          aliases: [],
        },
      ]);
    }
    return response(data);
  });
  expect(result.status).toBe("complete");
  expect(finalCalls).toBe(1);
  for (let i = 0; i < 40; i++) expect(visited.has(`other-${i}:members:0`)).toBe(true);
  expect(aliasNames.size).toBe(340); // Includes all 105 merged-member names and 192 accumulated aliases.
  expect(queries.some((q) => q.kind === "members" && q.entityId === "zz-member" && q.offset === 100)).toBe(true);
  expect(queries.every((q) => q.expectedRevision === snapshot.entitiesRevision)).toBe(true);
  const page = await query({ kind: "members", entityId: "zz-member" });
  expect(page.canonicalDefinition?.canonicalName).toBe("Keeper Alex");
  expect((await deps.identityConsolidation.snapshot()).settled).toBe(true);
});

test("unretained required registry work forces partial publication even if the final model claims complete", async () => {
  const { deps } = await fixture();
  const result = await run(deps, async (_model, context) =>
    response(JSON.parse(context.messages[0]!.content as string), true),
  );
  expect(result.status).toBe("partial");
  expect((await deps.identityConsolidation.snapshot()).settled).toBe(false);
});

test("injected ownership, a changed registry, and failed partition reads cannot publish a truncated registry", async () => {
  for (const failure of ["ownership", "revision", "read"] as const) {
    const { deps } = await fixture(),
      query = deps.entityRegistry.query;
    let injected = false;
    if (failure === "read")
      deps.entityRegistry.query = async (input, signal) => {
        if (input?.kind === "aliases" && input.entityId === "keeper")
          throw new AppError("db/locked", "Injected partition read failure");
        return query(input, signal);
      };
    await run(deps, async (_model, context) => {
      const data = JSON.parse(context.messages[0]!.content as string);
      if (data.partition) {
        injected = true;
        if (failure === "ownership")
          return message({
            summary: "Forged",
            refs: [{ entityId: "zz-member", canonicalId: "wrong" }],
            hasMore: false,
          });
        if (failure === "revision")
          await deps.entityRegistry.decide({
            op: "resolve",
            entityId: "late",
            kind: "person",
            canonicalName: "New fact",
            expectedRevision: (await query()).revision,
          });
      }
      return response(data);
    });
    if (failure !== "read") expect(injected).toBe(true);
    expect((await deps.identityConsolidation.snapshot()).derived).toBeNull();
    expect((await deps.identityConsolidation.snapshot()).settled).toBe(false);
  }
});

test("a generated new ID cannot overwrite an existing identity omitted by the selected registry", async () => {
  const { deps } = await fixture();
  const data: IdentityInput = {
    memories: [],
    digests: [{ summary: "Alex evidence", memoryIds: ["source"] }],
    identities: [],
    registryScan: { summary: "", hasMore: false },
  };
  const proposal = JSON.stringify({
    summary: "Supported",
    complete: true,
    merges: [],
    resolutions: [{ entityId: null, kind: "person", canonicalName: "Alex", aliases: [], memoryIds: ["source"] }],
  });
  const first = await identityPlan(proposal, await deps.identityConsolidation.snapshot(), data);
  const decision = first.decisions[0]!.input;
  if (decision.op !== "resolve") throw new Error("Expected generated resolve");
  await deps.entityRegistry.decide({ ...decision, canonicalName: "Existing different identity" });
  const plan = await identityPlan(proposal, await deps.identityConsolidation.snapshot(), data);
  await expect(checkNewIdentityIds(plan, data, deps.entityRegistry)).rejects.toMatchObject({
    code: "memory/invalid-input",
  });
});
