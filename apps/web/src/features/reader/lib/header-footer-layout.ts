import {
  HEADER_FOOTER_POSITIONS,
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
 * Read the configured slots into the six strip positions, keeping each slot's
 * stored order. `battery` silently drops where the platform can't report it,
 * and a band with no items reserves no space at all.
 */
export function resolveHeaderFooterLayout(
  settings: HeaderFooterSettings,
  { batteryAvailable }: { batteryAvailable: boolean },
): HeaderFooterLayout {
  const bands: Record<"header" | "footer", HeaderFooterBand> = {
    header: { left: [], center: [], right: [] },
    footer: { left: [], center: [], right: [] },
  };
  if (settings.enabled) {
    for (const position of HEADER_FOOTER_POSITIONS) {
      const [band, column] = position.split("-") as ["header" | "footer", "left" | "center" | "right"];
      bands[band][column] = settings.slots[position].filter((item) => item !== "battery" || batteryAvailable);
    }
  }
  const occupied = (band: HeaderFooterBand) => band.left.length > 0 || band.center.length > 0 || band.right.length > 0;
  return {
    header: occupied(bands.header) ? bands.header : null,
    footer: occupied(bands.footer) ? bands.footer : null,
  };
}
