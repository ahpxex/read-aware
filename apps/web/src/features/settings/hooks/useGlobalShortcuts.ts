import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { shortcutBindingsAtom } from "../../../state/ui";
import { chordMatchesEvent, resolveBinding } from "../lib/shortcuts";

type GlobalShortcutHandlers = {
  onOpenSearch: () => void;
  onOpenSettings: () => void;
};

/**
 * Wires the app-global keyboard shortcuts (open search, open settings) to their
 * live bindings, so edits made in the Shortcuts settings take effect at once.
 *
 * Reader page navigation and Esc-to-close are owned by the reader engine and
 * overlay surfaces respectively, so they are not handled here.
 */
export function useGlobalShortcuts({ onOpenSearch, onOpenSettings }: GlobalShortcutHandlers): void {
  const bindings = useAtomValue(shortcutBindingsAtom);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (chordMatchesEvent(resolveBinding("search", bindings), event)) {
        event.preventDefault();
        onOpenSearch();
        return;
      }
      if (chordMatchesEvent(resolveBinding("settings", bindings), event)) {
        event.preventDefault();
        onOpenSettings();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenSearch, onOpenSettings, bindings]);
}
