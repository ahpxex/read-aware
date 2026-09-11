import { expect, test } from "bun:test";
import fixture from "./context-bundle-book.fixture.json";
import { bookMemoryContextBundle, normalizeBookContextSnapshot } from "./context-bundle-book";

const source = () => normalizeBookContextSnapshot(fixture, fixture.bookId);
const chapters = [["c1.xhtml"], ["c2.xhtml"]];
test("book recipe applies chapter and unknown-provenance fences before serializing graph text", async () => {
  const snapshot = source();
  snapshot.digests.push({ ...snapshot.digests[0]!, index: 1, summary: "FUTURE", characters: "MALFORMED FUTURE" });
  snapshot.digests.push({ ...snapshot.digests[0]!, index: 2, flavor: "expository", summary: "WRONG FLAVOR" });
  snapshot.annotations.push({ ...snapshot.annotations[0]!, id: "missing", href: null, note: "UNLOCATED" });
  const bundle = await bookMemoryContextBundle(snapshot, { kind: "before", chapterIndex: 1 }, chapters);
  expect(bundle.content.items.map(row => row.kind)).toEqual(["annotation", "chapter_digest"]);
  expect(JSON.parse(bundle.content.items[1]!.text)).toEqual({ summary: "Opening chapter", entities: [{ name: "Alice", aliases: ["A"], note: "Introduced" }], relations: [{ from: "Alice", kind: "knows", to: "Bob" }] });
  expect(bundle.content.omissions).toEqual([{ kind: "memory", reason: "spoiler", count: 1 }, { kind: "annotation", reason: "spoiler", count: 1 },
    { kind: "chapter_digest", reason: "spoiler", count: 1 }, { kind: "chapter_digest", reason: "unavailable", count: 1 }]);
  for (const hidden of ["FUTURE", "WRONG FLAVOR", "UNLOCATED", "Book observation"]) expect(JSON.stringify(bundle)).not.toContain(hidden);
  expect(bundle.version).toMatch(/^cb1:[a-f0-9]{64}$/);
});

test("unknown fences disclose counts only; finished and expository include complete eligible sources", async () => {
  const snapshot = source();
  const unknown = await bookMemoryContextBundle(snapshot, { kind: "unknown" }, null);
  expect(unknown.content.items).toEqual([]); expect(unknown.content.omissions).toHaveLength(3);
  await expect(bookMemoryContextBundle(snapshot, { kind: "all" }, chapters)).rejects.toMatchObject({ code: "memory/invalid-input" });
  snapshot.readingStatus = "finished";
  const full = await bookMemoryContextBundle(snapshot, { kind: "all" }, null);
  expect(full.content.items).toHaveLength(3); expect(full.content.omissions).toEqual([]);
  snapshot.readingStatus = "reading"; snapshot.flavor = "expository";
  const expository = await bookMemoryContextBundle(snapshot, { kind: "all" }, null);
  expect(expository.content.items.map(row => row.kind)).toEqual(["memory", "annotation"]);
  expect(expository.content.omissions).toEqual([{ kind: "chapter_digest", reason: "unavailable", count: 1 }]);
});

test("source identities are deterministic, copied before awaits, scope-bound and independent of row order", async () => {
  const a = source(); a.readingStatus = "finished";
  a.memories.push({ id: "a", kind: "fact", text: "Earlier" });
  const first = await bookMemoryContextBundle(a, { kind: "all" }, chapters);
  a.memories.reverse();
  expect(await bookMemoryContextBundle(a, { kind: "all" }, chapters)).toEqual(first);
  const pending = bookMemoryContextBundle(a, { kind: "all" }, chapters);
  a.memories[0]!.text = "CHANGED";
  expect(await pending).toEqual(first);
  expect((await bookMemoryContextBundle(a, { kind: "all" }, chapters)).version).not.toBe(first.version);
  a.bookId = "other";
  expect((await bookMemoryContextBundle(a, { kind: "all" }, chapters)).version).not.toBe(first.version);
  expect(first.content.items.every(row => /^bitem1:[a-f0-9]{64}$/.test(row.revision))).toBe(true);
});

test("duplicate/ambiguous chapter anchors do not disclose annotations", async () => {
  const snapshot = source();
  const result = await bookMemoryContextBundle(snapshot, { kind: "before", chapterIndex: 2 }, [["c1.xhtml#a"], ["c1.xhtml#b"]]);
  expect(result.content.items.map(row => row.kind)).toEqual(["chapter_digest"]);
  expect(result.content.omissions).toContainEqual({ kind: "annotation", reason: "spoiler", count: 1 });
  snapshot.annotations[0]!.href = "c1.xhtml#a";
  const exact = await bookMemoryContextBundle(snapshot, { kind: "before", chapterIndex: 1 }, [["c1.xhtml#a"], ["c1.xhtml#b"]]);
  expect(exact.content.items[0]!.kind).toBe("annotation");
});

test("invalid visible data, forged schemas and oversized artifacts reject instead of exporting partial content", async () => {
  for (const mutate of [
    (s: ReturnType<typeof source>) => { s.memories.push(s.memories[0]!); },
    (s: ReturnType<typeof source>) => { s.digests[0]!.characters = "not JSON"; },
    (s: ReturnType<typeof source>) => { s.annotations[0]!.note = "\ud800"; },
    (s: ReturnType<typeof source>) => { s.memories[0]!.text = "x".repeat(1024 * 1024); },
    (s: ReturnType<typeof source>) => { s.memories = Array.from({ length: 513 }, (_, i) => ({ id: String(i), kind: "fact", text: "x" })); },
  ]) {
    const snapshot = source(); snapshot.readingStatus = "finished"; mutate(snapshot);
    await expect(bookMemoryContextBundle(snapshot, { kind: "all" }, chapters)).rejects.toMatchObject({ code: "memory/invalid-input" });
  }
  expect(() => normalizeBookContextSnapshot({ ...fixture, authority: true }, fixture.bookId)).toThrow();
  expect(() => normalizeBookContextSnapshot(fixture, "other")).toThrow();
});
