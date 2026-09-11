import { expect, test } from "bun:test";
import { normalizeEntityDecision, normalizeEntityQuery } from "./entity-registry";

const revision = `entities1:${"a".repeat(64)}`;

test("entity queries are bounded, literal, revision-pinned and mode-specific", () => {
  expect(normalizeEntityQuery()).toEqual({ kind: "identities", offset: 0, limit: 25 });
  expect(normalizeEntityQuery({ kind: "identities", search: "%_ OR '" })).toMatchObject({ search: "%_ OR '" });
  expect(normalizeEntityQuery({ kind: "aliases", entityId: "member", offset: 1, expectedRevision: revision })).toEqual({ kind: "aliases", entityId: "member", offset: 1, limit: 25, expectedRevision: revision });
  for (const query of [null, [], {}, { kind: "secret" }, { kind: "members" }, { kind: "identities", entityId: "a" },
    { kind: "aliases", entityId: "a", search: "x" }, { kind: "identities", offset: 1 }, { kind: "identities", offset: -1 },
    { kind: "identities", offset: Number.MAX_SAFE_INTEGER + 1 }, { kind: "identities", limit: null }, { kind: "identities", limit: 0 },
    { kind: "identities", limit: 101 }, { kind: "identities", limit: 1.5 }, { kind: "identities", search: "x".repeat(129) },
    { kind: "identities", expectedRevision: "bad" }, { kind: "identities", confirmed: true }]) {
    expect(() => normalizeEntityQuery(query as never)).toThrow();
  }
});

test("entity decisions copy the exact bounded candidate and reject injected authority", () => {
  const input = { op: "resolve" as const, entityId: "original-member", kind: "person", canonicalName: "Edition Name", aliases: ["Old Name"], expectedRevision: revision };
  const captured = normalizeEntityDecision(input);
  input.aliases[0] = "Changed while waiting";
  expect(captured).toMatchObject({ aliases: ["Old Name"] });
  expect(normalizeEntityDecision({ op: "merge", keepId: "keep", mergedId: "member", expectedRevision: revision })).toMatchObject({ keepId: "keep" });
  expect(normalizeEntityDecision({ ...input, canonicalName: "\ud83d\ude42".repeat(256) })).toHaveProperty("canonicalName");
  for (const change of [null, [], {}, { ...input, confirmed: true }, { ...input, scope: "user" }, { ...input, canonicalName: "\ud83d\ude42".repeat(257) },
    { ...input, aliases: null }, { ...input, aliases: [42] }, { ...input, aliases: [""] }, { ...input, aliases: Array(1) }, { ...input, aliases: Array(33).fill("a") },
    { ...input, kind: "" }, { ...input, expectedRevision: "profile2:" + "a".repeat(64) },
    { op: "merge", keepId: "keep", mergedId: "member", expectedRevision: revision, canonicalName: "Cannot rename by merging" }]) {
    expect(() => normalizeEntityDecision(change as never)).toThrow();
  }
});
