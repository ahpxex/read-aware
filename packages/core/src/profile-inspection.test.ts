import { expect, test } from "bun:test";
import { identityProfileContext, profileContextText, type ConsolidatedProfile, type ProfileContextSnapshot } from "./identity-consolidation";
import { normalizeProfileInspectionQuery, profileInspectionPage, type ProfileInspectionQuery } from "./profile-inspection";

const revision = (prefix: string, value = "a") => `${prefix}:${value.repeat(64)}`;
function fixture(count = 105) {
  const sources = Array.from({ length: count }, (_, index) => ({ memoryId: `memory-${index}`, revision: revision("mem1") }));
  const derived: ConsolidatedProfile = { version: 1, summary: "A\u{1f600}BC", sources,
    entityEvidence: count ? [{ eventId: "proposed-1", memoryIds: sources.map(source => source.memoryId) }, { eventId: "proposed-2", memoryIds: [sources[0]!.memoryId] }] : [] };
  if (!count) derived.summary = "";
  const snapshot: ProfileContextSnapshot = { profile: { summary: "Curated only", revision: revision("profile2") }, derived, sourceConditions: structuredClone(sources) };
  return { snapshot, derived };
}

test("summary pages retain character pairs, distinguish absence/empty and keep curated text separate", async () => {
  const { snapshot } = fixture();
  const first = await profileInspectionPage(snapshot, { limit: 2 });
  expect(first).toMatchObject({ kind: "summary", text: "A", totalLength: 5, nextOffset: 1, derivedStatus: "current", curatedExists: true });
  expect(await profileInspectionPage(snapshot, { offset: 1, limit: 2, expectedRevision: first.revision })).toMatchObject({ text: "\u{1f600}", nextOffset: 3 });
  await expect(profileInspectionPage(snapshot, { offset: 2, expectedRevision: first.revision })).rejects.toMatchObject({ code: "memory/invalid-query" });
  expect(JSON.stringify(first)).not.toContain("Curated only");
  expect(await profileInspectionPage({ ...snapshot, derived: null })).toMatchObject({ derivedStatus: "absent", text: null, totalLength: 0 });
  expect(await profileInspectionPage(fixture(0).snapshot)).toMatchObject({ derivedStatus: "current", text: "", totalLength: 0 });
});

test("source and flattened proposed-event evidence pagination are complete, bounded and cross-kind pinned", async () => {
  const { snapshot, derived } = fixture(), first = await profileInspectionPage(snapshot);
  for (const kind of ["sources", "entityEvidence"] as const) {
    const items: unknown[] = []; let offset = 0;
    for (;;) {
      const page = await profileInspectionPage(snapshot, { kind, offset, limit: 100, expectedRevision: first.revision });
      if (page.kind === "summary") throw Error("Expected rows");
      expect(page.items.length).toBeLessThanOrEqual(100); items.push(...page.items);
      if (page.nextOffset === null) break;
      expect(page.nextOffset).toBeGreaterThan(offset); offset = page.nextOffset;
    }
    expect(items).toEqual(kind === "sources" ? derived.sources.map(source => ({ ...source, currentRevision: source.revision }))
      : derived.entityEvidence.flatMap(entry => entry.memoryIds.map(memoryId => ({ eventId: entry.eventId, memoryId }))));
  }
  await expect(profileInspectionPage(snapshot, { kind: "sources", offset: 106, expectedRevision: first.revision })).rejects.toMatchObject({ code: "memory/invalid-query" });
});

test("stale provenance remains inspectable while prompt context discards it; source-only changes invalidate every page kind", async () => {
  const { snapshot } = fixture(), first = await profileInspectionPage(snapshot);
  snapshot.sourceConditions[0]!.revision = revision("mem1", "b");
  snapshot.sourceConditions.splice(1, 1);
  expect(identityProfileContext(snapshot)).toMatchObject({ consolidated: null, derivedStatus: "stale" });
  expect(profileContextText(identityProfileContext(snapshot))).toBe("Curated only");
  expect(await profileInspectionPage(snapshot)).toMatchObject({ text: "A\u{1f600}BC", derivedStatus: "stale" });
  expect(await profileInspectionPage(snapshot, { kind: "sources", limit: 2 })).toMatchObject({ items: [
    { memoryId: "memory-0", revision: revision("mem1"), currentRevision: revision("mem1", "b") },
    { memoryId: "memory-1", currentRevision: null },
  ] });
  for (const kind of ["summary", "sources", "entityEvidence"] as const) await expect(profileInspectionPage(snapshot, { kind, expectedRevision: first.revision })).rejects.toMatchObject({ code: "memory/conflict" });
  const stale = await profileInspectionPage(snapshot);
  snapshot.sourceConditions.push({ memoryId: "newly-eligible", revision: revision("mem1") });
  await expect(profileInspectionPage(snapshot, { expectedRevision: stale.revision })).rejects.toMatchObject({ code: "memory/conflict" });
});

test("malformed and future blocks disclose only invalid status, never raw content or evidence", async () => {
  const { snapshot, derived } = fixture();
  for (const block of [{ ...derived, version: 2 }, { ...derived, raw: "secret" }, { ...derived, sources: [derived.sources[0], derived.sources[0]] },
    { ...derived, entityEvidence: [{ eventId: "x", memoryIds: ["foreign"] }] }]) {
    for (const kind of ["summary", "sources", "entityEvidence"] as const) {
      const page = await profileInspectionPage({ ...snapshot, derived: block }, { kind });
      expect(page.derivedStatus).toBe("invalid");
      expect(page.kind === "summary" ? page.text : page.items).toEqual(page.kind === "summary" ? null : []);
      expect(JSON.stringify(page)).not.toContain("secret");
    }
  }
});

test("queries reject authority/filter injection and capture mutable values before hashing", async () => {
  for (const input of [null, [], { kind: null }, { kind: "curated" }, { raw: true }, { bookId: "b" }, { limit: 1 }, { kind: "sources", limit: 101 },
    { offset: 1 }, { offset: -1 }, { offset: 0.5 }, { limit: null }, { expectedRevision: revision("profile2") }]) {
    expect(() => normalizeProfileInspectionQuery(input as ProfileInspectionQuery)).toThrow();
  }
  const { snapshot, derived } = fixture(), input = { kind: "sources" as const, limit: 1 };
  const pending = profileInspectionPage(snapshot, input);
  derived.sources[0]!.memoryId = "mutated"; input.limit = 100;
  expect(await pending).toMatchObject({ items: [{ memoryId: "memory-0" }] });
  const page = await profileInspectionPage(snapshot);
  snapshot.profile.revision = revision("profile2", "b");
  await expect(profileInspectionPage(snapshot, { expectedRevision: page.revision })).rejects.toMatchObject({ code: "memory/conflict" });
});
