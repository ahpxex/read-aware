import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { PluginTreeView } from "../lib/plugin-types";
import { pluginTreeBranches, visiblePluginTreeRows, type PluginTreeRow } from "../lib/plugin-tree";
import type { PluginResultRunner } from "../components/plugin-view-types";

export function usePluginTree(view: PluginTreeView, busy: boolean, onResult: PluginResultRunner) {
  const [expanded, setExpanded] = useState(() => new Set(view.expandedIds));
  const [focused, setFocused] = useState<string | undefined>();
  const elements = useRef(new Map<string, HTMLDivElement>());
  const ownsFocus = useRef(false);
  const previousRows = useRef<PluginTreeRow[]>([]);
  const search = useRef({ text: "", time: 0 });
  const rows = visiblePluginTreeRows(view.nodes, expanded);
  let focusedId = focused;
  // A live snapshot may remove the focused node: prefer a surviving ancestor.
  while (focusedId && !rows.some(row => row.node.id === focusedId)) {
    focusedId = previousRows.current.find(row => row.node.id === focusedId)?.parentId;
  }
  focusedId ??= rows[0]?.node.id;

  useLayoutEffect(() => {
    previousRows.current = rows;
    if (focused !== focusedId) {
      setFocused(focusedId);
      if (ownsFocus.current && focusedId) elements.current.get(focusedId)?.focus();
    }
  });
  useLayoutEffect(() => {
    const branches = pluginTreeBranches(view.nodes);
    setExpanded(current => {
      const next = new Set([...current].filter(id => branches.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [view.nodes]);

  const focus = (id: string | undefined) => {
    if (!id) return;
    setFocused(id);
    elements.current.get(id)?.focus();
  };
  const toggle = (row: PluginTreeRow, open = !expanded.has(row.node.id)) => {
    if (busy || !row.node.children?.length) return;
    focus(row.node.id);
    setExpanded(current => {
      const next = new Set(current);
      if (open) next.add(row.node.id); else next.delete(row.node.id);
      return next;
    });
  };
  const activate = (row: PluginTreeRow) => {
    if (busy) return;
    focus(row.node.id);
    if (row.node.onSelect) void onResult(row.node.onSelect, { presentation: row.node.presentation, dialogTitle: row.node.title });
    else toggle(row);
  };
  const keyDown = (event: KeyboardEvent, row: PluginTreeRow, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    const key = event.key;
    if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "Enter", " ", "*"].includes(key)) {
      event.preventDefault(); event.stopPropagation();
      if (busy) return;
      if (key === "ArrowDown") focus(rows[Math.min(rows.length - 1, index + 1)]?.node.id);
      else if (key === "ArrowUp") focus(rows[Math.max(0, index - 1)]?.node.id);
      else if (key === "Home") focus(rows[0]?.node.id);
      else if (key === "End") focus(rows.at(-1)?.node.id);
      else if (key === "ArrowLeft") {
        if (row.node.children?.length && expanded.has(row.node.id)) toggle(row, false);
        else focus(row.parentId);
      } else if (key === "ArrowRight") {
        if (!expanded.has(row.node.id)) toggle(row, true);
        else focus(row.node.children?.[0]?.id);
      } else if (key === "*") setExpanded(current => new Set([...current,
        ...rows.filter(sibling => sibling.parentId === row.parentId && sibling.node.children?.length).map(sibling => sibling.node.id)]));
      else activate(row);
    } else if (key.length === 1 && !busy) {
      event.stopPropagation();
      const now = Date.now(), character = key.toLocaleLowerCase();
      const text = now - search.current.time > 700 ? character : search.current.text + character;
      search.current = { text, time: now };
      const prefix = [...text].every(letter => letter === character) ? character : text;
      const order = [...rows.slice(index + 1), ...rows.slice(0, index + 1)];
      focus(order.find(candidate => candidate.node.title.toLocaleLowerCase().startsWith(prefix))?.node.id);
    }
  };
  return { rows, expanded, focusedId, elements, ownsFocus, focus, toggle, activate, keyDown };
}
