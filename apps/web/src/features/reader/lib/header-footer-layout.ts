import {
  HEADER_FOOTER_ITEMS,
  type HeaderFooterItem,
  type HeaderFooterSettings,
} from "../../../domain/settings/header-footer-settings";

/** Pixel height of each strip. The paginator borrows it from the page margin
 *  (see `--foliate-reserved-*` on the reader viewport), so an active strip
 *  never reflows text that already fits. */
export const READER_STRIP_HEIGHT_PX = 24;

export type HeaderFooterBand = Record<"left" | "center" | "right", HeaderFooterItem[]>;

export type HeaderFooterLayout = {
  /** Null when the strip is disabled or no item lands on it. */
  header: HeaderFooterBand | null;
  footer: HeaderFooterBand | null;
};

/**
 * Group the configured items into the six slots. Items join a slot in
 * `HEADER_FOOTER_ITEMS` order; `battery` silently drops where the platform
 * can't report it, and a band with no items reserves no space at all.
 */
export function resolveHeaderFooterLayout(
  settings: HeaderFooterSettings,
  { batteryAvailable }: { batteryAvailable: boolean },
): HeaderFooterLayout {
  const header: HeaderFooterBand = { left: [], center: [], right: [] };
  const footer: HeaderFooterBand = { left: [], center: [], right: [] };
  if (settings.enabled) {
    for (const item of HEADER_FOOTER_ITEMS) {
      if (item === "battery" && !batteryAvailable) continue;
      const match = /^(header|footer)-(left|center|right)$/.exec(settings.items[item]);
      if (!match) continue;
      (match[1] === "header" ? header : footer)[match[2] as "left" | "center" | "right"].push(item);
    }
  }
  const occupied = (band: HeaderFooterBand) => band.left.length > 0 || band.center.length > 0 || band.right.length > 0;
  return {
    header: occupied(header) ? header : null,
    footer: occupied(footer) ? footer : null,
  };
}
