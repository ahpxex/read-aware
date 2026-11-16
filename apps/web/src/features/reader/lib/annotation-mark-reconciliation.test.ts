import { expect, test } from "bun:test";
import type { Highlight, Note } from "../../annotations/lib/annotation-types";
import type { FoliateAnnotation, FoliateView } from "./foliate-engine";
import { applyAnnotationMarks, reconcileAnnotationMarks } from "./highlight-renderer";

const base = { bookId: "book", chapterHref: "chapter", text: "text", createdAt: "now", updatedAt: "now" };
const highlight = (id: string, cfiRange: string | null): Highlight => ({
  ...base,
  type: "highlight",
  color: "yellow",
  id,
  cfiRange,
});
const note = (id: string, cfiRange: string | null): Note => ({ ...base, type: "note", content: "note", id, cfiRange });
function fixture() {
  const added: FoliateAnnotation[] = [],
    deleted: string[] = [],
    errors: unknown[] = [];
  return {
    added,
    deleted,
    errors,
    view: {
      addAnnotation: async (item: FoliateAnnotation) => {
        added.push(item);
        return undefined;
      },
      deleteAnnotation: async (item: FoliateAnnotation) => {
        deleted.push(item.value);
        return undefined;
      },
    },
  };
}
test("reconciliation removes obsolete anchors, updates style and keeps a note's line when its highlight is removed", async () => {
  const f = fixture();
  await reconcileAnnotationMarks(
    f.view,
    [highlight("gone", "old"), highlight("h", "shared"), note("n", "shared")],
    [note("n", "shared"), { ...highlight("new", "new"), color: "blue", style: "underline" }, note("unanchored", null)],
    new AbortController().signal,
    (error) => f.errors.push(error),
  );
  // The note's line was already drawn on its own layer beside the highlight, so it stays put.
  expect(f.deleted).toEqual(["old", "shared"]);
  expect(f.added).toEqual([{ value: "new", id: "new", color: "#3b82f6", style: "underline" }]);
  expect(f.errors).toEqual([]);
});
test("marks that did not change are not repainted; a recolor and a new mark are", async () => {
  const f = fixture();
  const kept = highlight("kept", "kept"),
    recolored = highlight("re", "re"),
    noted = note("n", "noted");
  await reconcileAnnotationMarks(
    f.view,
    [kept, recolored, noted],
    [kept, { ...recolored, color: "green" }, noted, highlight("added", "added")],
    new AbortController().signal,
    (error) => f.errors.push(error),
  );
  expect(f.deleted).toEqual([]);
  expect(f.added.map((item) => item.value)).toEqual(["re", "added"]);
  expect(f.added[0]!.color).toBe("#4ade80");
  expect(f.errors).toEqual([]);
});
test("a shared anchor's mark is the first highlight the menu resolves; its note adds its own line", async () => {
  const f = fixture();
  await reconcileAnnotationMarks(
    f.view,
    [],
    [note("n", "same"), highlight("first", "same"), highlight("second", "same")],
    new AbortController().signal,
    (error) => f.errors.push(error),
  );
  expect(f.added.map((item) => [item.id, item.style])).toEqual([
    ["first", "highlight"],
    ["n", "note"],
  ]);
});
test("overlay recreation uses the same shared-range ownership as live reconciliation", () => {
  const f = fixture(),
    view = f.view as FoliateView;
  const highlights = [highlight("first", "shared"), highlight("second", "shared")];
  applyAnnotationMarks(view, highlights, [
    note("shared-note", "shared"),
    note("first-note", "note"),
    note("second-note", "note"),
  ]);
  expect(f.added.map((item) => [item.id, item.style])).toEqual([
    ["first", "highlight"],
    // A highlight's fill has no line to dash, so its notes get their own line;
    // two notes on a range share one.
    ["shared-note", "note"],
    ["first-note", "note"],
  ]);
});
test("retirement during an engine operation prevents subsequent painting; a failed anchor does not hide other marks", async () => {
  const f = fixture(),
    life = new AbortController();
  let release!: () => void;
  const work = reconcileAnnotationMarks(
    {
      ...f.view,
      deleteAnnotation: async () =>
        new Promise<undefined>((r) => {
          release = () => r(undefined);
        }),
    },
    [highlight("old", "old")],
    [highlight("new", "new")],
    life.signal,
    (error) => f.errors.push(error),
  );
  life.abort();
  release();
  await work;
  expect(f.added).toEqual([]);
  await reconcileAnnotationMarks(
    {
      ...f.view,
      deleteAnnotation: async () => {
        throw Error("stale CFI");
      },
    },
    [highlight("old", "old")],
    [highlight("new", "new")],
    new AbortController().signal,
    (error) => f.errors.push(error),
  );
  expect(f.errors).toHaveLength(1);
  expect(f.added[0]!.id).toBe("new");
});
