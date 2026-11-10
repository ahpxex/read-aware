// READAWARE: keep publisher layout inside the text column.
//
// The paginator lays a section out in CSS columns (or one scrolled column). A
// few publisher idioms break out of that column and get clipped, or spill into
// the neighbouring page:
//
// - a body taken out of flow (`position: absolute`, `display: table`: a common
//   cover-page recipe), which leaves the columns empty — a blank page;
// - code set `white-space: pre` whose long lines never wrap;
// - text set `nowrap`, blocks with a fixed pixel width, and absolutely
//   positioned blocks sized against the multi-page viewport;
// - tables wider than a column.
//
// Only elements that are measured to overflow are touched, and only through
// `data-foliate-fit` markers styled by one injected sheet, so each pass starts
// by removing the previous pass's markers: a new font size or column width is
// fitted from the publisher's own layout, never from an earlier fix.

import { setStylesImportant } from "./paginator-geometry.js";
import { LayoutWindow } from "./paginator-window.js";

const FIT = "data-foliate-fit";
const SHEET_ID = "foliate-fit";
/** A table narrower than this share of its width after scaling is scrolled instead of shrunk. */
const MIN_TABLE_SCALE = 0.6;
/** Rounding slack before an element counts as wider than the column. */
const SLACK_PX = 2;
/** Upper bound on elements measured per pass, so a pathological section cannot stall layout. */
const MAX_ELEMENTS = 20_000;

const SHEET = `
[${FIT}~="pre"] { white-space: pre-wrap !important; overflow-wrap: anywhere !important; }
[${FIT}~="text"] { white-space: normal !important; overflow-wrap: anywhere !important; }
[${FIT}~="flow"] { position: static !important; inset: auto !important; width: auto !important; max-width: 100% !important; }
[${FIT}~="clamp"] { max-width: 100% !important; box-sizing: border-box !important; overflow-wrap: anywhere !important; }
[${FIT}~="zoom"] { zoom: var(--foliate-fit-zoom) !important; }
[${FIT}~="scroll"] { display: block !important; max-width: 100% !important; overflow-x: auto !important; }
`;

/** Put an out-of-flow body back into the flow the columns are built from. */
export function flowBody(doc: Document): void {
  const style = doc.defaultView?.getComputedStyle(doc.body);
  if (!style) return;
  const styles: Record<string, string> = {};
  if (style.position === "absolute" || style.position === "fixed") styles.position = "static";
  if (style.display === "table" || style.display === "inline-table") styles.display = "block";
  if (Object.keys(styles).length) setStylesImportant(doc.body, styles);
}

const widest = (element: Element) => {
  let width = 0;
  // An element broken across columns has one rect per column.
  for (const rect of element.getClientRects()) width = Math.max(width, rect.width);
  return width;
};

function mark(element: Element, fit: string) {
  const current = element.getAttribute(FIT);
  element.setAttribute(FIT, current ? `${current} ${fit}` : fit);
}

/** The elements a pass measures: the whole laid-out document, or the subtrees of `joined`. */
function* measured(body: HTMLElement, joined: readonly Element[] | undefined): Generator<Element, void, undefined> {
  if (joined) {
    for (const root of joined) {
      yield root;
      yield* root.querySelectorAll("*");
    }
    return;
  }
  // Content the layout window still defers has no boxes to measure; it is fitted when it joins.
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_ELEMENT, (node) =>
    LayoutWindow.defers(node as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) yield node as Element;
}

/**
 * Fit every element wider than the body's content box. Horizontal writing only.
 *
 * A pass over the document starts from the publisher's layout: the previous
 * pass's markers are removed first. `joined` names content that has just
 * joined the layout (see `LayoutWindow`): only it is measured, and what the
 * rest of the document already carries is kept.
 */
export function fitWideContent(doc: Document, joined?: readonly Element[]): void {
  const win = doc.defaultView;
  const body = doc.body;
  if (!win || !body) return;
  if (!doc.getElementById(SHEET_ID)) {
    const sheet = doc.createElement("style");
    sheet.id = SHEET_ID;
    sheet.textContent = SHEET;
    (doc.head ?? doc.documentElement).append(sheet);
  }
  if (!joined)
    for (const element of doc.querySelectorAll(`[${FIT}]`)) {
      element.removeAttribute(FIT);
      (element as HTMLElement).style?.removeProperty("--foliate-fit-zoom");
    }
  if (win.getComputedStyle(doc.documentElement).writingMode.startsWith("vertical")) return;
  const bodyStyle = win.getComputedStyle(body);
  const limit = body.clientWidth - (parseFloat(bodyStyle.paddingLeft) || 0) - (parseFloat(bodyStyle.paddingRight) || 0);
  if (limit <= 0) return;

  // Measure first, then write: one layout for the whole pass.
  const wide: { element: Element; width: number }[] = [];
  let seen = 0;
  for (const element of measured(body, joined)) {
    if (++seen > MAX_ELEMENTS) break;
    // Media are sized by the paginator itself; formulas and vector art keep their geometry.
    if (element.closest("img, svg, video, canvas, math")) continue;
    const width = widest(element);
    if (width > limit + SLACK_PX) wide.push({ element, width });
  }
  const within = (inner: Element, outer: Element) => inner !== outer && outer.contains(inner);
  // Tables scale or scroll as a whole; a wrapper around one is clamped as well.
  const tables = wide.filter(
    ({ element }) =>
      element.localName === "table" &&
      !wide.some((other) => other.element.localName === "table" && within(element, other.element)),
  );
  for (const { element, width } of tables) {
    const scale = limit / width;
    if (scale >= MIN_TABLE_SCALE) {
      mark(element, "zoom");
      (element as HTMLElement).style.setProperty("--foliate-fit-zoom", scale.toFixed(3));
    } else mark(element, "scroll");
  }
  const others = wide.filter(
    ({ element }) =>
      element.localName !== "table" &&
      !tables.some((table) => within(element, table.element)) &&
      !wide.some((other) => other.element.localName !== "table" && within(element, other.element)),
  );
  for (const { element } of others) {
    // Positioned out of flow, it sizes against the whole multi-page viewport
    // (a title page's publisher line, say); put it back in the column.
    const { position } = win.getComputedStyle(element);
    mark(element, position === "absolute" || position === "fixed" ? "flow" : "clamp");
    // Unbreakable text inside it: code lines and nowrap runs.
    for (const inner of [element, ...element.querySelectorAll("*")]) {
      if (tables.some((table) => table.element === inner || within(inner, table.element))) continue;
      const { whiteSpace } = win.getComputedStyle(inner);
      if (whiteSpace === "pre") mark(inner, "pre");
      else if (whiteSpace === "nowrap") mark(inner, "text");
    }
  }
}
