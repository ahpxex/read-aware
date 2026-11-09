import { expect, test } from "bun:test";
import { flattenToc } from "./epub-utils";
import type { TocEntry } from "./reader-types";
import {
  buildTocOutline,
  buildTocOutlineView,
  tocAncestors,
  tocBranchIds,
  toggleTocFold,
  type TocFolds,
} from "./toc-outline";

// Vol 1 > (Ch 1, Ch 2 > (2.1, 2.2)), Vol 2 > (Ch 3, Ch 4), Afterword
const entries: TocEntry[] = [
  ["v1", 0],
  ["c1", 1],
  ["c2", 1],
  ["c2a", 2],
  ["c2b", 2],
  ["v2", 0],
  ["c3", 1],
  ["c4", 1],
  ["after", 0],
].map(([id, depth], spineIndex) => ({
  id: id as string,
  href: `${id}.xhtml`,
  label: id as string,
  depth: depth as number,
  spineIndex,
}));
const at = (id: string) => entries.findIndex((entry) => entry.id === id);
const outline = buildTocOutline(entries);
const folds = (pinned: string[] = [], folded: string[] = []): TocFolds => ({
  pinned: new Set(pinned),
  folded: new Set(folded),
});
const visible = (current: number, state: TocFolds) =>
  buildTocOutlineView(entries, outline, current, state).rows.map((row) => row.entry.id);

test("the depth run recovers parents and branches", () => {
  expect(outline.parents).toEqual([-1, 0, 0, 2, 2, -1, 5, 5, -1]);
  expect(outline.branches).toEqual([true, false, true, false, false, true, false, false, false]);
  expect(tocAncestors(outline, at("c2b"))).toEqual([at("c2"), at("v1")]);
  expect(tocAncestors(outline, at("v2"))).toEqual([]);
  expect(tocAncestors(outline, -1)).toEqual([]);
  expect([...tocBranchIds(entries, outline)]).toEqual(["v1", "c2", "v2"]);
});

test("a depth jump still nests under the nearest shallower entry", () => {
  const jumped = buildTocOutline([{ depth: 0 }, { depth: 2 }, { depth: 1 }, { depth: 0 }]);
  expect(jumped.parents).toEqual([-1, 0, 0, -1]);
  expect(jumped.branches).toEqual([true, false, false, false]);
});

test("by default only the current chapter's path is open", () => {
  expect(visible(-1, folds())).toEqual(["v1", "v2", "after"]);
  expect(visible(at("c2a"), folds())).toEqual(["v1", "c1", "c2", "c2a", "c2b", "v2", "after"]);
  expect(visible(at("c3"), folds())).toEqual(["v1", "v2", "c3", "c4", "after"]);
  // A current branch is not itself opened: only what holds the current entry.
  expect(visible(at("c2"), folds())).toEqual(["v1", "c1", "c2", "v2", "after"]);
});

test("pinned branches stay open wherever the reader is", () => {
  expect(visible(at("c3"), folds(["v1"]))).toEqual(["v1", "c1", "c2", "v2", "c3", "c4", "after"]);
  // A pinned branch inside a folded one stays hidden with it.
  expect(visible(at("c3"), folds(["c2"]))).toEqual(["v1", "v2", "c3", "c4", "after"]);
  expect(visible(at("c3"), folds(["v1", "c2"]))).toEqual(["v1", "c1", "c2", "c2a", "c2b", "v2", "c3", "c4", "after"]);
});

test("rows report branch and open state", () => {
  const { rows } = buildTocOutlineView(entries, outline, at("c3"), folds());
  expect(rows.map(({ entry, branch, open }) => [entry.id, branch, open])).toEqual([
    ["v1", true, false],
    ["v2", true, true],
    ["c3", false, false],
    ["c4", false, false],
    ["after", false, false],
  ]);
  expect(rows.map((row) => row.index)).toEqual([at("v1"), at("v2"), at("c3"), at("c4"), at("after")]);
});

test("the current row is the chapter itself, or the outermost folded branch holding it", () => {
  const current = (index: number, state: TocFolds) => {
    const view = buildTocOutlineView(entries, outline, index, state);
    return view.currentRow < 0 ? null : view.rows[view.currentRow].entry.id;
  };
  expect(current(at("c2a"), folds())).toBe("c2a");
  expect(current(at("c2a"), folds([], ["c2"]))).toBe("c2");
  expect(current(at("c2a"), folds([], ["c2", "v1"]))).toBe("v1");
  expect(current(at("c2a"), folds([], ["v1"]))).toBe("v1");
  expect(current(-1, folds())).toBeNull();
  expect(current(entries.length, folds())).toBeNull();
});

test("toggling pins other branches and folds the current path only for the stay", () => {
  // Off the current path: opening pins, closing unpins.
  let state = toggleTocFold(folds(), "v1", false);
  expect([...state.pinned]).toEqual(["v1"]);
  expect(state.folded.size).toBe(0);
  state = toggleTocFold(state, "v1", false);
  expect(state.pinned.size).toBe(0);

  // On the current path: closing folds it; reopening lifts the fold without pinning.
  state = toggleTocFold(folds(), "v2", true);
  expect([...state.folded]).toEqual(["v2"]);
  expect(state.pinned.size).toBe(0);
  state = toggleTocFold(state, "v2", true);
  expect(state.folded.size).toBe(0);
  expect(state.pinned.size).toBe(0);

  // A pinned branch that holds the current chapter: closing both unpins and folds.
  state = toggleTocFold(folds(["v2"]), "v2", true);
  expect(state.pinned.size).toBe(0);
  expect([...state.folded]).toEqual(["v2"]);
});

test("flattenToc lifts the children of a target-less group to its level", () => {
  const flat = flattenToc([
    { id: 0, href: "preface.xhtml", label: "Preface" },
    {
      id: 1,
      label: "Volume One",
      subitems: [
        { id: 2, href: "one.xhtml", label: "One", subitems: [{ id: 3, href: "one.xhtml#a", label: "One A" }] },
        { id: 4, href: "two.xhtml", label: "Two" },
      ],
    },
  ]);
  expect(flat.map(({ id, depth, spineIndex }) => [id, depth, spineIndex])).toEqual([
    ["0", 0, 0],
    ["2", 0, 1],
    ["3", 1, 2],
    ["4", 0, 3],
  ]);
  // So "Preface" does not become a branch that would fold the volume away.
  expect(buildTocOutline(flat).branches).toEqual([false, true, false, false]);
});
