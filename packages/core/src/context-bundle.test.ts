import { expect, test } from "bun:test";
import golden from "./context-bundle.golden.json";
import { canonicalContextBundle, createContextBundle, normalizeContextBundleContent, validateContextBundle } from "./context-bundle";

test("shared native/TS golden identifies immutable ordered content, not JSON object order", async () => {
  expect<unknown>(await validateContextBundle(golden)).toEqual(golden);
  const reversed = Object.fromEntries(Object.entries(golden.content).reverse());
  expect((await createContextBundle(reversed)).version).toBe(golden.version);
  expect(canonicalContextBundle(reversed)).toBe(canonicalContextBundle(golden.content));
  for (const modify of [
    (c: typeof golden.content) => { c.items.reverse(); },
    (c: typeof golden.content) => { c.items[0]!.revision = "new"; },
    (c: typeof golden.content) => { c.items[0]!.text += " new"; },
    (c: typeof golden.content) => { c.sourceRevision = "new"; },
    (c: typeof golden.content) => { c.scope.id = "other"; },
    (c: typeof golden.content) => { c.omissions[0]!.count++; },
  ]) {
    const content = structuredClone(golden.content); modify(content);
    expect((await createContextBundle(content)).version).not.toBe(golden.version);
    await expect(validateContextBundle({ ...golden, content })).rejects.toMatchObject({ code: "memory/invalid-input" });
  }
});

test("all four recipes retain valid scope and source kinds; mismatched scopes and raw messages reject", async () => {
  for (const [kind, scope, itemKind] of [
    ["user_profile_context", { kind: "user" }, "curated_profile"],
    ["reading_intent_context", { kind: "user" }, "reading_goal"],
    ["reading_intent_context", { kind: "book", id: "b" }, "memory"],
    ["book_memory_context", { kind: "book", id: "b" }, "chapter_digest"],
    ["conversation_insights_context", { kind: "book", id: "b" }, "conversation_insight"],
    ["conversation_insights_context", { kind: "conversation", id: "c" }, "conversation_insight"],
  ]) {
    const value = { ...golden.content, kind, scope, items: [{ ...golden.content.items[0], kind: itemKind }], omissions: [] };
    expect(await createContextBundle(value)).toMatchObject({ content: { kind, scope } });
  }
  for (const patch of [
    { scope: { kind: "user" } }, { kind: "user_profile_context" }, { kind: "raw_transcript" },
    { items: [{ ...golden.content.items[0], kind: "conversation_insight" }] },
    { omissions: [{ kind: "reading_goal", reason: "privacy", count: 1 }] },
    { schemaVersion: 2 }, { recipeVersion: 2 }, { extra: "forged" }, { scope: { kind: "book", id: "b", path: "/private" } },
  ]) expect(() => normalizeContextBundleContent({ ...golden.content, ...patch })).toThrow();
});

test("input is copied before hashing; duplicate sources, invalid Unicode and oversized content reject without truncation", async () => {
  const content = structuredClone(golden.content), result = createContextBundle(content);
  content.items[0]!.text = "mutated"; expect<unknown>(await result).toEqual(golden);
  for (const patch of [
    { items: [golden.content.items[0], golden.content.items[0]] },
    { omissions: [golden.content.omissions[0], golden.content.omissions[0]] },
    { omissions: [{ kind: "memory", reason: "privacy", count: 0 }] },
    { sourceRevision: "" }, { sourceRevision: "\ud800" }, { sourceRevision: "\u0000" },
    { items: [{ ...golden.content.items[0], text: "x".repeat(1024 * 1024) }] },
    { items: [{ ...golden.content.items[0], text: "\u4e2d".repeat(400_000) }] },
    { items: Array.from({ length: 513 }, (_, id) => ({ ...golden.content.items[0], id: String(id) })) },
  ]) expect(() => normalizeContextBundleContent({ ...golden.content, ...patch })).toThrow();
  await expect(validateContextBundle({ ...golden, createdAt: "forged" })).rejects.toBeDefined();
  expect(normalizeContextBundleContent({ ...golden.content, items: [], omissions: [] }).items).toEqual([]);
});
