import { isMacOS } from "../../../platform/environment";

export type ShortcutItem = {
  id: string;
  label: string;
  /** Pre-rendered key tokens, e.g. ["⌘", "K"]. */
  keys: string[];
};

export type ShortcutGroup = {
  category: string;
  items: ShortcutItem[];
};

/**
 * The shortcuts the app actually honors today. `mod` renders as ⌘ on macOS and
 * Ctrl elsewhere. Global shortcuts are wired in `useGlobalShortcuts`; reading
 * and overlay shortcuts are handled by the reader engine and overlay surfaces.
 */
export function getShortcutGroups(): ShortcutGroup[] {
  const mod = isMacOS() ? "⌘" : "Ctrl";

  return [
    {
      category: "Global",
      items: [
        { id: "search", label: "Open search", keys: [mod, "K"] },
        { id: "settings", label: "Open settings", keys: [mod, ","] },
      ],
    },
    {
      category: "Reading",
      items: [
        { id: "next-page", label: "Next page / scroll down", keys: ["→"] },
        { id: "prev-page", label: "Previous page / scroll up", keys: ["←"] },
        { id: "toggle-controls", label: "Toggle reader controls", keys: ["Click"] },
      ],
    },
    {
      category: "Overlays",
      items: [{ id: "close", label: "Close dialog or overlay", keys: ["Esc"] }],
    },
  ];
}
