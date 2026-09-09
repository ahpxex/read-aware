import { useEffect } from "react";
import { subscribeToAppKeyDown } from "../../../platform/app-keydown";
import { appShortcutForEvent } from "../lib/shortcut-dispatch";

type GlobalShortcutHandlers = {
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onNewConversation: () => void;
  /** Mod+digit → the Nth primary destination; return false to decline (out of
   *  range, or a surface where switching makes no sense) and let the key pass. */
  onSelectPrimaryDestination: (index: number) => boolean;
};

/** The physical digit row (and numpad), layout-independent. */
const DIGIT_CODE_RE = /^(?:Digit|Numpad)([1-9])$/;

/**
 * Wires the app-global keyboard shortcuts (new conversation, search, settings,
 * mod+digit primary navigation) to their live bindings, so edits made in
 * Shortcuts take effect at once.
 *
 * Reader page navigation and Esc-to-close are owned by the reader engine and
 * overlay surfaces respectively, so they are not handled here.
 */
export function useGlobalShortcuts({
  onOpenSearch,
  onOpenSettings,
  onNewConversation,
  onSelectPrimaryDestination,
}: GlobalShortcutHandlers): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      const shortcut = appShortcutForEvent(event);
      if (event.defaultPrevented) return;
      if (shortcut === "search") {
        event.preventDefault();
        onOpenSearch();
        return;
      }
      if (shortcut === "settings") {
        event.preventDefault();
        onOpenSettings();
        return;
      }
      if (shortcut === "new-conversation") {
        event.preventDefault();
        onNewConversation();
        return;
      }
      // After the rebindable chords, so a user override onto mod+digit wins.
      if (
        shortcut === undefined &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey
      ) {
        const digit = DIGIT_CODE_RE.exec(event.code);
        if (digit && onSelectPrimaryDestination(Number(digit[1]) - 1)) {
          event.preventDefault();
        }
      }
    }

    return subscribeToAppKeyDown(handleKeyDown);
  }, [
    onOpenSearch,
    onOpenSettings,
    onNewConversation,
    onSelectPrimaryDestination,
  ]);
}
