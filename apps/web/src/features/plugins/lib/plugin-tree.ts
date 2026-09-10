import type { PluginTreeNode } from "./plugin-types";

export type PluginTreeRow = {
  node: PluginTreeNode;
  parentId?: string;
  level: number;
  position: number;
  size: number;
};

export function visiblePluginTreeRows(nodes: PluginTreeNode[], expanded: ReadonlySet<string>): PluginTreeRow[] {
  const rows: PluginTreeRow[] = [];
  const visit = (nodes: PluginTreeNode[], level: number, parentId?: string) => {
    nodes.forEach((node, index) => {
      rows.push({ node, level, parentId, position: index + 1, size: nodes.length });
      if (node.children?.length && expanded.has(node.id)) visit(node.children, level + 1, node.id);
    });
  };
  visit(nodes, 1);
  return rows;
}

export function pluginTreeBranches(nodes: PluginTreeNode[]): Set<string> {
  const ids = new Set<string>();
  const visit = (nodes: PluginTreeNode[]) => nodes.forEach(node => {
    if (node.children?.length) { ids.add(node.id); visit(node.children); }
  });
  visit(nodes);
  return ids;
}
