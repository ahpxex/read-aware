/**
 * The text of a fixed-layout page, as its section document carries it.
 *
 * A PDF page's document holds its text in a `.textLayer` that the engine
 * draws with each raster (`foliate-js/src/pdf.ts`): empty until the page first
 * rasters, emptied and rebuilt at every raster after — a zoom, a resize, a
 * change of page colors — and marked `ready` once it is whole. Anything that
 * keeps Ranges into a page's text therefore has to wait for that mark, and to
 * take them again whenever the page rasters. A page without such a layer (a
 * pre-paginated EPUB's) has its text as soon as its document loads.
 */

/** The layer a PDF page's text is drawn into; null for a page whose text is its own markup. */
export const pageTextLayer = (doc: Document): HTMLElement | null => doc.querySelector<HTMLElement>(".textLayer");

/** Whether the page's text is there to read — not still being drawn. */
export function pageTextReady(doc: Document): boolean {
  const layer = pageTextLayer(doc);
  return !layer || layer.dataset.readawareTextState === "ready";
}

/**
 * Everything on a fixed-layout page. Such a page is displayed whole, so this
 * is what "the text on screen" means for it; it spans the page's body rather
 * than its text, so it stays valid while the text under it is rebuilt.
 */
export function pageRange(doc: Document): Range | null {
  if (!doc.body) return null;
  const range = doc.createRange();
  range.selectNodeContents(doc.body);
  return range;
}

/**
 * The unit a reader looking at `viewport` (the reading area, in the window's
 * coordinates) is at: the first one not yet scrolled past its top. On a
 * fixed-layout page the whole page counts as displayed, so where the reader
 * is on it is a matter of where the page is scrolled to, not of a range.
 * The last unit when all are above; -1 only for none.
 */
export function firstUnitInView(units: Range[], viewport: Pick<DOMRect, "top">): number {
  const frame = units[0]?.startContainer.ownerDocument?.defaultView?.frameElement;
  if (!frame) return units.length ? 0 : -1;
  // Unit boxes are in the frame's own coordinates, and a frame may be scaled.
  const box = frame.getBoundingClientRect();
  const scale = frame.clientHeight ? box.height / frame.clientHeight : 1;
  const top = (viewport.top - box.top) / (scale || 1);
  const index = units.findIndex((unit) => unit.getBoundingClientRect().bottom > top + 1);
  return index < 0 ? units.length - 1 : index;
}
