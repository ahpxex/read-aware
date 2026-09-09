import { describe, expect, test } from "bun:test";
import type { ChapterDigest } from "@read-aware/core";
import { normalizeBookGraphQuery, queryBookGraph } from "./book-graph";

const digest = (chapterIndex: number, name: string, extras: Partial<ChapterDigest> = {}): ChapterDigest => ({
  chapterIndex, summary: `Summary ${chapterIndex}`, characters: [{ name }], relations: [], digestVersion: 2, ...extras,
});
describe("shared book graph projection", () => {
  test("validates modes and copies requests before asynchronous callers use them", () => {
    const input = { names: [" Ada ", "Ada"] }; const normalized = normalizeBookGraphQuery(input); input.names[0] = "changed";
    expect(normalized).toEqual({ names: ["Ada"] });
    for (const bad of [{ names: [] }, { names: [1] }, { names: [""] }, { names: ["a".repeat(257)] }, { names: Array(9).fill("a") },
      { chapterIndex: -1 }, { chapterIndex: 1.2 }, { chapterIndex: "2" }, { chapterIndex: 0, names: ["a"] }, { confirmSpoiler: true }]) {
      expect(() => normalizeBookGraphQuery(bad as never)).toThrow();
    }
  });
  test("filters before alias/note merging and does not reveal hidden digest existence", () => {
    const rows = [digest(0, "Ada"), digest(1, "Secret Identity", { characters: [{ name: "Secret Identity", aliases: ["Ada"], note: "late reveal" }] })];
    const result = queryBookGraph(rows, { names: ["Ada"] }, { kind: "before", chapterIndex: 1 });
    expect(result.graph).toBe("profiles"); expect(JSON.stringify(result)).not.toContain("late reveal"); expect(JSON.stringify(result)).not.toContain("Secret Identity");
    expect(queryBookGraph(rows, { chapterIndex: 1 }, { kind: "before", chapterIndex: 1 })).toEqual(queryBookGraph(rows.slice(0, 1), { chapterIndex: 1 }, { kind: "before", chapterIndex: 1 }));
    expect(queryBookGraph(rows, {}, { kind: "unknown" }).graph).toBe("unavailable");
  });
  test("excludes reclassified stale flavor and isolates chapter response objects", () => {
    const rows = [digest(0, "Legacy"), digest(1, "Concept", { flavor: "expository" })];
    const overview = queryBookGraph(rows, {}, { kind: "all" }, "expository");
    expect(overview.graph === "overview" && overview.entityCount).toBe(1);
    expect(JSON.stringify(overview)).not.toContain("Legacy");
    const chapter = queryBookGraph(rows, { chapterIndex: 1 }, { kind: "all" }, "expository");
    if (chapter.graph !== "chapter") throw Error("chapter expected");
    chapter.entities[0]!.name = "changed"; expect(rows[1]!.characters[0]!.name).toBe("Concept");
  });
  test("bounds profile fan-out, deduplicates overlapping queries and declares truncated edges", () => {
    const characters = Array.from({ length: 205 }, (_, n) => ({ name: `Entity ${n}` }));
    const relations = characters.slice(1).map(character => ({ from: "Entity 0", kind: "knows", to: character.name }));
    const rows = [digest(0, "unused", { characters, relations })];
    const result = queryBookGraph(rows, { names: ["Entity", "Entity 0"] }, { kind: "all" });
    if (result.graph !== "profiles") throw Error("profiles expected");
    expect(result.profiles).toHaveLength(200); expect(new Set(result.profiles.map(p => p.name)).size).toBe(200); expect(result.truncated).toBe(true);
    expect(result.profiles[0]!.relations).toHaveLength(40); expect(result.profiles[0]!.relationsTruncated).toBe(true);
  });
});
