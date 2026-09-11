import { expect, test } from "bun:test";
import { readingIntentContextBundle, type ReadingIntentSource } from "./context-bundle-intent";
const source = (pluginId = "reading-goals"): ReadingIntentSource => ({ pluginId, providerId: "reading-goal", revision: "doc:1", text: "Compare evidence" });

test("intention artifact order is stable, attributed and tied to source versions and scope", async () => {
  const a = source(), b = source("another"), scope = { kind: "book" as const, id: "one" };
  const bundle = await readingIntentContextBundle(scope, [a, b]);
  expect(await readingIntentContextBundle(scope, [b, a])).toEqual(bundle);
  expect(bundle.content.items.map(item => item.text)).toEqual(["Compare evidence", "Compare evidence"]);
  expect(bundle.content.items[0]!.label).toContain("another/reading-goal");
  expect((await readingIntentContextBundle({ kind: "user" }, [a, b])).version).not.toBe(bundle.version);
  expect((await readingIntentContextBundle(scope, [a, { ...b, revision: "doc:2" }])).version).not.toBe(bundle.version);
});
test("absent sources, cleared tombstones and no available provider are distinguishable", async () => {
  const scope = { kind: "user" as const }, empty = await readingIntentContextBundle(scope, []);
  const absent = await readingIntentContextBundle(scope, [{ ...source(), revision: null, text: null }]);
  const cleared = await readingIntentContextBundle(scope, [{ ...source(), text: null }]);
  expect(new Set([empty.version, absent.version, cleared.version]).size).toBe(3);
  for (const bundle of [empty, absent, cleared]) expect(bundle.content.items).toEqual([]);
});
test("snapshots freeze inputs and reject malformed, duplicate or oversized sources without truncation", async () => {
  const values = [source()], scope = { kind: "book" as const, id: "one" };
  const pending = readingIntentContextBundle(scope, values); values[0]!.text = "mutated"; scope.id = "other";
  expect((await pending).content.items[0]!.text).toBe("Compare evidence");
  for (const sources of [[source(), source()], [{ ...source(), revision: null }], [{ ...source(), text: "" }], [{ ...source(), text: "bad\0" }],
    [{ ...source(), raw: "secret" }], [{ ...source(), text: "x".repeat(1024 * 1024) }]]) {
    await expect(readingIntentContextBundle({ kind: "user" }, sources)).rejects.toMatchObject({ code: "memory/invalid-input" });
  }
  await expect(readingIntentContextBundle({ kind: "book", id: "" }, [])).rejects.toMatchObject({ code: "memory/invalid-input" });
});
