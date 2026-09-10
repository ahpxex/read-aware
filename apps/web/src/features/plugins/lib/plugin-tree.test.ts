import { expect, test } from "bun:test";
import type { PluginTreeNode, PluginTreeView } from "./plugin-types";
import { normalizePluginView } from "./plugin-view";
import { pluginTreeBranches, visiblePluginTreeRows } from "./plugin-tree";

const tree = (): PluginTreeView => ({ kind: "tree", title: "Contents", expandedIds: ["part"], nodes: [
  { id: "part", title: "Part one", children: [{ id: "chapter", title: "Chapter one", onSelect: () => null }] },
  { id: "end", title: "End" },
] });

test("trees normalize at root and in composed blocks, preserving callbacks and only declared fields", () => {
  const source = tree();
  const result = normalizePluginView({ ...source, pagination: { page: 1, onNext: () => null } });
  expect(result.kind).toBe("tree");
  if (result.kind !== "tree") throw new Error("Expected tree");
  expect(result.nodes[0].children?.[0].onSelect).toBe(source.nodes[0].children?.[0].onSelect);
  expect(result.nodes).not.toBe(source.nodes);
  expect(result.expandedIds).toEqual(["part"]);
  expect(result.pagination?.page).toBe(1);
  expect(normalizePluginView({ kind: "detail", content: [{ kind: "group", blocks: [source] }] }).kind).toBe("detail");
  expect(normalizePluginView({ ...source, nodes: [], expandedIds: [] }).kind).toBe("tree");
});

test("tree bounds include hidden descendants and reject cycles, ambiguous IDs and invalid initial expansion", () => {
  const source = tree();
  let deep: PluginTreeNode = { id: "12", title: "12" };
  for (let i = 11; i >= 1; i--) deep = { id: String(i), title: String(i), children: [deep] };
  expect(normalizePluginView({ ...source, nodes: [deep], expandedIds: [] }).kind).toBe("tree");
  const cycle: PluginTreeNode = { id: "cycle", title: "Cycle" }; cycle.children = [cycle];
  const invalid = [
    { ...source, title: " " }, { ...source, nodes: [{ id: "x", title: "" }] },
    { ...source, nodes: [{ id: " ", title: "x" }] }, { ...source, nodes: [cycle] },
    { ...source, nodes: [{ id: "0", title: "0", children: [deep] }], expandedIds: [] },
    { ...source, nodes: [...source.nodes, { id: "chapter", title: "Duplicate descendant" }] },
    { ...source, expandedIds: ["end"] }, { ...source, expandedIds: ["absent"] },
    { ...source, expandedIds: ["part", "part"] }, { ...source, nodes: [{ id: "x", title: "x", onSelect: true }] },
    { ...source, nodes: [{ id: "x", title: "x", children: "not nodes" }] },
    { ...source, nodes: [{ id: "x", title: "x", children: Array.from({ length: 500 }, (_, i) => ({ id: `n${i}`, title: String(i) })) }] },
  ];
  for (const value of invalid) expect(() => normalizePluginView(value)).toThrow();
  expect(normalizePluginView({ kind: "tree", title: "500 nodes", nodes: Array.from({ length: 500 }, (_, i) => ({ id: String(i), title: String(i) })) }).kind).toBe("tree");
});

test("visible rows preserve sibling counts, depth and parent identity without expanding or executing callbacks", () => {
  const nodes = tree().nodes;
  expect([...pluginTreeBranches(nodes)]).toEqual(["part"]);
  expect(visiblePluginTreeRows(nodes, new Set()).map(row => row.node.id)).toEqual(["part", "end"]);
  const rows = visiblePluginTreeRows(nodes, new Set(["part"]));
  expect(rows.map(({ node, ...rest }) => ({ id: node.id, ...rest }))).toEqual([
    { id: "part", level: 1, parentId: undefined, position: 1, size: 2 },
    { id: "chapter", level: 2, parentId: "part", position: 1, size: 1 },
    { id: "end", level: 1, parentId: undefined, position: 2, size: 2 },
  ]);
});
