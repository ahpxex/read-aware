import {
  HEADER_FOOTER_ITEMS,
  HEADER_FOOTER_POSITIONS,
  HEADER_FOOTER_SHOW_POSITION,
  type HeaderFooterItem,
  type HeaderFooterPosition,
  type HeaderFooterSettings,
} from "../../../domain/settings/header-footer-settings";

function cloneSlots(settings: HeaderFooterSettings): Record<HeaderFooterPosition, HeaderFooterItem[]> {
  const slots = {} as Record<HeaderFooterPosition, HeaderFooterItem[]>;
  for (const position of HEADER_FOOTER_POSITIONS) slots[position] = [...settings.slots[position]];
  return slots;
}

function removeItem(slots: Record<HeaderFooterPosition, HeaderFooterItem[]>, item: HeaderFooterItem): void {
  for (const position of HEADER_FOOTER_POSITIONS) {
    slots[position] = slots[position].filter((id) => id !== item);
  }
}

/**
 * Move an item to `target` — or out of every position when target is "hidden".
 * Inserted before `beforeItem` when it is in the target, appended otherwise.
 * Moving onto itself is a no-op.
 */
export function moveHeaderFooterItem(
  settings: HeaderFooterSettings,
  item: HeaderFooterItem,
  target: HeaderFooterPosition | "hidden",
  beforeItem: HeaderFooterItem | null,
): HeaderFooterSettings {
  if (target !== "hidden" && beforeItem === item) return settings;
  if (target !== "hidden" && beforeItem === null) {
    const list = settings.slots[target];
    if (list[list.length - 1] === item && settings.slots[target].filter((id) => id === item).length === 1) {
      return settings;
    }
  }
  const slots = cloneSlots(settings);
  removeItem(slots, item);
  if (target !== "hidden") {
    const list = slots[target];
    const index = beforeItem ? list.indexOf(beforeItem) : -1;
    if (index >= 0) list.splice(index, 0, item);
    else list.push(item);
  }
  return { ...settings, slots };
}

/** Put a hidden item back at its show position (appended). */
export function showHeaderFooterItem(settings: HeaderFooterSettings, item: HeaderFooterItem): HeaderFooterSettings {
  return moveHeaderFooterItem(settings, item, HEADER_FOOTER_SHOW_POSITION[item], null);
}

/** Remove an item from every position. */
export function hideHeaderFooterItem(settings: HeaderFooterSettings, item: HeaderFooterItem): HeaderFooterSettings {
  return moveHeaderFooterItem(settings, item, "hidden", null);
}

/** Items placed nowhere, in catalog order. */
export function hiddenHeaderFooterItems(
  settings: HeaderFooterSettings,
  available: readonly HeaderFooterItem[] = HEADER_FOOTER_ITEMS,
): HeaderFooterItem[] {
  const placed = new Set(HEADER_FOOTER_POSITIONS.flatMap((position) => settings.slots[position]));
  return available.filter((item) => !placed.has(item));
}
