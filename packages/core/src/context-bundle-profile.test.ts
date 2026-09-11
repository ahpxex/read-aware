import { expect, test } from "bun:test";
import { profileContextBundle } from "./context-bundle-profile";
import { profileInspectionPage } from "./profile-inspection";
import { validateContextBundle } from "./context-bundle";
import type { ProfileContextSnapshot } from "./identity-consolidation";

const revision = (prefix: string, char = "a") => `${prefix}:${char.repeat(64)}`;
function fixture(): ProfileContextSnapshot {
  const source = { memoryId: "private-source", revision: revision("mem1") };
  return { profile: { summary: "Curated \u{1f600}", revision: revision("profile2") },
    derived: { version: 1, summary: "Inferred", sources: [source], entityEvidence: [{ eventId: "private-evidence", memoryIds: [source.memoryId] }] },
    sourceConditions: [structuredClone(source)] };
}

test("profile recipe preserves curated precedence, full text, provenance and deterministic versions", async () => {
  const input = fixture(), result = await profileContextBundle(input);
  expect(result.derivedStatus).toBe("current");
  expect(result.bundle.content.sourceRevision).toBe((await profileInspectionPage(input)).revision);
  expect(result.bundle.content.items.map(item => [item.kind, item.text])).toEqual([["curated_profile", "Curated \u{1f600}"], ["derived_profile", "Inferred"]]);
  expect(result.bundle.content.items[0]!.revision).toBe(input.profile.revision);
  expect(result.bundle.content.omissions).toEqual([]);
  expect(await validateContextBundle(result.bundle)).toEqual(result.bundle);
  expect(await profileContextBundle(structuredClone(input))).toEqual(result);
  const serialized = JSON.stringify(result.bundle);
  expect(serialized).not.toContain("private-source"); expect(serialized).not.toContain("private-evidence");
});

test("absence is distinct from explicit empty curated or derived text", async () => {
  const input = fixture(); input.profile.summary = null; input.derived = null;
  expect((await profileContextBundle(input)).bundle.content).toMatchObject({ items: [], omissions: [] });
  input.profile.summary = "";
  expect((await profileContextBundle(input)).bundle.content.items).toMatchObject([{ kind: "curated_profile", text: "" }]);
  input.derived = { version: 1, summary: "", sources: [], entityEvidence: [] }; input.sourceConditions = [];
  expect((await profileContextBundle(input)).bundle.content.items).toMatchObject([{ text: "" }, { kind: "derived_profile", text: "" }]);
});

test("stale and invalid derived blocks are omitted without leaking their source or text", async () => {
  const input = fixture(); input.sourceConditions = [];
  const stale = await profileContextBundle(input);
  expect(stale.derivedStatus).toBe("stale");
  expect(stale.bundle.content.omissions).toEqual([{ kind: "derived_profile", reason: "unavailable", count: 1 }]);
  expect(JSON.stringify(stale.bundle)).not.toContain("Inferred");
  input.derived = { secret: "never export" };
  const invalid = await profileContextBundle(input);
  expect(invalid.derivedStatus).toBe("invalid");
  expect(invalid.bundle.content.omissions).toEqual(stale.bundle.content.omissions);
  expect(JSON.stringify(invalid.bundle)).not.toContain("never export");
  expect(invalid.bundle.version).not.toBe(stale.bundle.version);
});

test("source-only revisions and curated replacement invalidate version; async callers cannot mutate the captured snapshot", async () => {
  const input = fixture(), original = structuredClone(input);
  const pending = profileContextBundle(input);
  input.profile.summary = "mutated"; input.sourceConditions[0]!.revision = revision("mem1", "b");
  expect(await pending).toEqual(await profileContextBundle(original));
  const changed = await profileContextBundle(input);
  expect(changed.bundle.version).not.toBe((await pending).bundle.version);
  input.profile.revision = revision("profile2", "b");
  expect((await profileContextBundle(input)).bundle.version).not.toBe(changed.bundle.version);
});

test("legacy oversized curated text fails the artifact limit instead of silently truncating", async () => {
  const input = fixture(); input.profile.summary = "x".repeat(1024 * 1024);
  await expect(profileContextBundle(input)).rejects.toMatchObject({ code: "memory/invalid-input" });
});
