import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

type GlobalShortcutHandlers = {
  onOpenSearch: () => void;
};

/**
 * Wires the app-global keyboard shortcuts documented in the Shortcuts settings:
 * - Cmd/Ctrl+K opens search
 * - Cmd/Ctrl+, opens settings
 *
 * Reader page navigation and Esc-to-close are owned by the reader engine and
 * overlay surfaces respectively, so they are not handled here.
 */
export function useGlobalShortcuts({ onOpenSearch }: GlobalShortcutHandlers): void {
  const navigate = useNavigate();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        onOpenSearch();
      } else if (event.key === ",") {
        event.preventDefault();
        void navigate({ to: "/settings" });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, onOpenSearch]);
}
