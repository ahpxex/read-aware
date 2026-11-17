import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { headerActionsAtom, selectionActionsAtom, textUnitReaderModeAtom } from "../../plugins";
import { menuCatalog } from "../lib/menu-catalog";
import { menuConfigAtom, resolveMenuLayouts, type MenuCatalog, type MenuConfig } from "../state/menu-config";

/** What every customizable surface can hold right now (see `menuCatalog`). */
export function useMenuCatalog(): MenuCatalog {
  const headerActions = useAtomValue(headerActionsAtom);
  const selectionActions = useAtomValue(selectionActionsAtom);
  const textUnitReaderMode = useAtomValue(textUnitReaderModeAtom);
  return useMemo(
    () => menuCatalog({ headerActions, selectionActions, textUnitReaderMode }),
    [headerActions, selectionActions, textUnitReaderMode],
  );
}

/** The layouts as rendered — the one resolution the header and editor share. */
export function useMenuLayouts(): MenuConfig {
  const config = useAtomValue(menuConfigAtom);
  const catalog = useMenuCatalog();
  return useMemo(() => resolveMenuLayouts(config, catalog), [config, catalog]);
}
