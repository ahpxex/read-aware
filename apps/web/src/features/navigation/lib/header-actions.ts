import type { ReactNode } from "react";
import type { MenuOverflowEntry } from "../../menus/components/MenuOverflow";

/**
 * One atomized contextual header action: the inline icon plus its dots-menu
 * fallback. Surfaces hand AppHeader a LIST of these (never an opaque node),
 * so a narrowing window can collapse contextual actions one by one — the
 * primary navigation is canonical and never yields width to them.
 */
export type HeaderActionEntry = {
  id: string;
  /** Inline rendering: an icon button or a popover trigger. */
  inline: ReactNode;
  /** Rendering when collapsed into the dots overflow menu. */
  overflow: MenuOverflowEntry;
};
