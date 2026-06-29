import { useCallback, useMemo } from "react";
import { useAtom } from "jotai";
import { shelfSelectionAtom } from "../../../state/ui";

/**
 * Shelf multi-select state for batch management. Backed by a single ephemeral
 * atom so the header's management menu (which enters selection) and the shelf
 * surfaces (which toggle and act on it) stay in sync without prop drilling.
 */
export function useShelfSelection() {
  const [selection, setSelection] = useAtom(shelfSelectionAtom);
  const { active, ids } = selection;

  const selectedIds = useMemo(() => new Set(ids), [ids]);

  const enter = useCallback(() => setSelection({ active: true, ids: [] }), [setSelection]);
  const exit = useCallback(() => setSelection({ active: false, ids: [] }), [setSelection]);
  const clear = useCallback(() => setSelection((s) => ({ ...s, ids: [] })), [setSelection]);

  const toggle = useCallback(
    (id: string) =>
      setSelection((s) => ({
        ...s,
        ids: s.ids.includes(id) ? s.ids.filter((x) => x !== id) : [...s.ids, id],
      })),
    [setSelection],
  );

  const selectAll = useCallback(
    (allIds: string[]) => setSelection((s) => ({ ...s, ids: allIds })),
    [setSelection],
  );

  return { active, ids, selectedIds, enter, exit, clear, toggle, selectAll };
}
