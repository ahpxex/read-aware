import { expect, test } from "bun:test";
import type { Highlight, Note } from "../../annotations/lib/annotation-types";
import type { FoliateAnnotation, FoliateView } from "./foliate-engine";
import { applyHighlights, applyNotes, reconcileAnnotationMarks } from "./highlight-renderer";

const base = { bookId: "book", chapterHref: "chapter", text: "text", createdAt: "now", updatedAt: "now" };
const highlight = (id: string, cfiRange: string | null): Highlight => ({ ...base, type: "highlight", color: "yellow", id, cfiRange });
const note = (id: string, cfiRange: string | null): Note => ({ ...base, type: "note", content: "note", id, cfiRange });
function fixture() {
  const added: FoliateAnnotation[] = [], deleted: string[] = [], errors: unknown[] = [];
  return { added, deleted, errors, view: {
    addAnnotation: async (item: FoliateAnnotation) => { added.push(item); return undefined; },
    deleteAnnotation: async (item: FoliateAnnotation) => { deleted.push(item.value); return undefined; },
  } };
}
test("reconciliation removes obsolete anchors, updates style and restores a note when its highlight is removed", async () => {
  const f = fixture();
  await reconcileAnnotationMarks(f.view, [highlight("gone", "old"), highlight("h", "shared"), note("n", "shared")],
    [note("n", "shared"), { ...highlight("new", "new"), color: "blue", style: "underline" }, note("unanchored", null)],
    new AbortController().signal, error => f.errors.push(error));
  expect(f.deleted).toEqual(["old"]);
  expect(f.added).toEqual([{ value: "new", id: "new", color: "#3b82f6", style: "underline" },
    { value: "shared", id: "n", color: "#78716c", style: "note" }]);
  expect(f.errors).toEqual([]);
});
test("a shared anchor is painted once with the same first highlight the menu resolves", async () => {
  const f = fixture();
  await reconcileAnnotationMarks(f.view, [], [note("n", "same"), highlight("first", "same"), highlight("second", "same")],
    new AbortController().signal, error => f.errors.push(error));
  expect(f.added).toHaveLength(1); expect(f.added[0]!.id).toBe("first");
});
test("overlay recreation uses the same shared-range ownership as live reconciliation", () => {
  const f = fixture(), view = f.view as FoliateView;
  const highlights = [highlight("first", "shared"), highlight("second", "shared")];
  applyHighlights(view, highlights);
  applyNotes(view, [note("hidden", "shared"), note("first-note", "note"), note("second-note", "note")], highlights);
  expect(f.added.map(item => item.id)).toEqual(["first", "first-note"]);
});
test("retirement during an engine operation prevents subsequent painting; a failed anchor does not hide other marks", async () => {
  const f = fixture(), life = new AbortController(); let release!: () => void;
  const work = reconcileAnnotationMarks({ ...f.view, deleteAnnotation: async () => new Promise<undefined>(r => { release = () => r(undefined); }) },
    [highlight("old", "old")], [highlight("new", "new")], life.signal, error => f.errors.push(error));
  life.abort(); release(); await work; expect(f.added).toEqual([]);
  await reconcileAnnotationMarks({ ...f.view, deleteAnnotation: async () => { throw Error("stale CFI"); } },
    [highlight("old", "old")], [highlight("new", "new")], new AbortController().signal, error => f.errors.push(error));
  expect(f.errors).toHaveLength(1); expect(f.added[0]!.id).toBe("new");
});
