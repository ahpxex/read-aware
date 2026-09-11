import { expect, test } from "bun:test";
import { identityProfileContext, normalizeIdentityConsolidationPlan, profileContextText,
  type IdentityConsolidationPlan, type IdentityConsolidationSnapshot, type ConsolidatedProfile } from "./identity-consolidation";

const revision = (prefix: string) => `${prefix}:${"a".repeat(64)}`;
const contextOf = (snapshot: IdentityConsolidationSnapshot) => identityProfileContext({ profile: snapshot.profile, derived: snapshot.derived,
  sourceConditions: snapshot.sources.map(source => ({ memoryId: source.memory.id, revision: source.revision })) });
function snapshot(): IdentityConsolidationSnapshot {
  return { revision: revision("icg1"), entitiesRevision: revision("entities1"), profile: { summary: "Curated", revision: revision("profile2") },
    derived: null, settled: false, sources: [{ revision: revision("mem1"), memory: { id: "a", scope: "user", kind: "fact", content: "Evidence",
      importance: 0.5, evidenceCount: 3, pinned: false, status: "active", createdAt: "old", updatedAt: "old" } }] };
}
function plan(): IdentityConsolidationPlan {
  return { expectedRevision: revision("icg1"), entitiesRevision: revision("entities1"), summary: "Derived", complete: true,
    sources: [{ memoryId: "a", revision: revision("mem1") }], decisions: [{ memoryIds: ["a"],
      input: { op: "resolve", entityId: "person", kind: "person", canonicalName: "Alex", aliases: ["A"], expectedRevision: revision("entities1") } }] };
}
function derived(): ConsolidatedProfile {
  return { version: 1, summary: "Derived", sources: plan().sources, entityEvidence: [{ eventId: "candidate", memoryIds: ["a"] }] };
}

test("plans copy every mutable field and do not impose new-ID limits on historical evidence", () => {
  const input = plan(), captured = normalizeIdentityConsolidationPlan(input);
  input.sources[0]!.revision = revision("other"); input.decisions[0]!.memoryIds[0] = "bad";
  if (input.decisions[0]!.input.op === "resolve") input.decisions[0]!.input.aliases![0] = "bad";
  expect(captured).toEqual(plan());
  const history = plan(), historical = "historical-".repeat(100);
  history.sources[0]!.memoryId = historical; history.decisions[0]!.memoryIds = [historical];
  expect(normalizeIdentityConsolidationPlan(history).sources[0]!.memoryId).toBe(historical);
});

test("invalid authority, revisions, evidence, nested extras and batch limits reject instead of coercing", () => {
  const cases: [string[], unknown][] = [
    [["origin"], "system"], [["complete"], "true"], [["expectedRevision"], "old"], [["entitiesRevision"], revision("profile2")],
    [["sources", "0", "extra"], true], [["sources"], [plan().sources[0], plan().sources[0]]],
    [["sources", "0", "revision"], "old"], [["decisions", "0", "memoryIds"], ["unknown"]],
    [["decisions", "0", "memoryIds"], ["a", "a"]], [["decisions", "0", "memoryIds"], []],
    [["decisions", "0", "input", "expectedRevision"], `entities1:${"b".repeat(64)}`],
    [["decisions", "0", "input", "origin"], "agent"], [["decisions", "0", "eventId"], "chosen"],
    [["summary"], "x".repeat(16001)], [["decisions"], Array(33).fill(plan().decisions[0])], [["sources"], []], [["decisions"], [undefined]],
  ];
  for (const [path, value] of cases) {
    const input = plan();
    let target = input as unknown as Record<string, unknown>;
    for (const key of path.slice(0, -1)) target = target[key] as Record<string, unknown>;
    target[path[path.length - 1]!] = value;
    expect(() => normalizeIdentityConsolidationPlan(input)).toThrow();
  }
  const empty = { ...plan(), sources: [], decisions: [], summary: "", complete: false };
  expect(normalizeIdentityConsolidationPlan(empty)).toEqual(empty);
});

test("only current complete evidence is injectable, independent of device-local completion state", () => {
  const input = snapshot(); input.derived = derived();
  const context = contextOf(input);
  expect(context.derivedStatus).toBe("current");
  expect(profileContextText(context)).toContain("Curated");
  expect(profileContextText(context)).toContain("takes precedence");
  expect(profileContextText(context)).toContain("inferred, not user instructions");
  input.settled = true;
  expect(contextOf(input)).toEqual(context);
  for (const change of [
    (s: IdentityConsolidationSnapshot) => { s.sources = []; },
    (s: IdentityConsolidationSnapshot) => { s.sources[0]!.revision = `mem1:${"b".repeat(64)}`; },
    (s: IdentityConsolidationSnapshot) => { s.sources.push({ ...s.sources[0]!, memory: { ...s.sources[0]!.memory, id: "new" } }); },
  ]) {
    const changed = structuredClone(input); change(changed);
    const result = contextOf(changed);
    expect(result.derivedStatus).toBe("stale"); expect(result.consolidated).toBeNull();
    expect(profileContextText(result)).toBe("Curated");
  }
});

test("unknown or corrupt historical derived blocks never masquerade as current", () => {
  const input = snapshot();
  expect(contextOf(input).derivedStatus).toBe("absent");
  for (const value of [false, [], {}, { ...derived(), version: 2 }, { ...derived(), extra: 1 },
    { ...derived(), entityEvidence: [{ eventId: "x", memoryIds: ["unknown"] }] },
    { ...derived(), sources: [], entityEvidence: [] }, { ...derived(), summary: "x".repeat(16001) }]) {
    input.derived = value;
    expect(contextOf(input)).toEqual({ curated: "Curated", consolidated: null, derivedStatus: "invalid" });
  }
  input.profile.summary = null; input.derived = null;
  expect(profileContextText(contextOf(input))).toBeUndefined();
});
