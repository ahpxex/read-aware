import type { ReadingVisibleTextState } from "@read-aware/core";
import { createLogger } from "../../../platform/logger";
import type { FoliateView } from "./foliate-engine";

const log = createLogger("reading-visible-text");
const MAX_CHARS = 12_000;
const MAX_NODES = 20_000;
export type ReadingVisibleText = { text: string; state: ReadingVisibleTextState };
type Box = Pick<DOMRect, "left" | "top" | "right" | "bottom">;

const unavailable = (reason: ReadingVisibleTextState["reason"]): ReadingVisibleText => ({
  text: "", state: { status: "unavailable", source: null, truncated: false, reason },
});
const intersects = (a: Box, b: Box) => a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
const clip = (a: Box, b: Box): Box => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
  right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });

function prefix(text: string, limit: number): string {
  const end = text.charCodeAt(limit - 1);
  return text.slice(0, end >= 0xd800 && end <= 0xdbff ? limit - 1 : limit);
}

function read(view: FoliateView): ReadingVisibleText {
  const range = view.lastLocation?.range;
  if (!view.isFixedLayout && range) {
    const text = range.toString();
    return { text: prefix(text, MAX_CHARS), state: { status: text.trim() ? "available" : "empty",
      source: "range", truncated: text.length > MAX_CHARS } };
  }
  const renderer = view.renderer;
  if (!view.lastLocation || !renderer) return unavailable("not-ready");
  if (!view.isFixedLayout) return unavailable("not-ready");
  const rect = renderer.getBoundingClientRect();
  const window = renderer.ownerDocument.defaultView;
  if (!renderer.isConnected || !window) return unavailable("not-visible");
  const viewport = clip(rect, { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight });
  if (viewport.right <= viewport.left || viewport.bottom <= viewport.top) return unavailable("not-visible");
  let text = "", visited = 0, layers = 0, pending = false, truncated = false, hasPdf = false;
  for (const { doc } of renderer.getContents()) {
    const layer = doc.querySelector<HTMLElement>(".textLayer");
    if (!layer) continue;
    hasPdf = true;
    const frame = doc.defaultView?.frameElement;
    if (!frame?.isConnected) continue;
    const style = window.getComputedStyle(frame);
    if (style.visibility === "hidden" || style.visibility === "collapse" || style.display === "none") continue;
    const bounds = frame.getBoundingClientRect();
    if (!intersects(viewport, bounds) || bounds.width <= 0 || bounds.height <= 0 || frame.clientWidth <= 0 || frame.clientHeight <= 0) continue;
    layers++;
    if (layer.dataset.readawareTextState !== "ready") { pending = true; continue; }
    // Text rectangles use iframe coordinates; the frame can itself be scaled.
    const scaleX = bounds.width / frame.clientWidth, scaleY = bounds.height / frame.clientHeight;
    const visible = clip(viewport, bounds);
    const local = { left: (visible.left - bounds.left) / scaleX, right: (visible.right - bounds.left) / scaleX,
      top: (visible.top - bounds.top) / scaleY, bottom: (visible.bottom - bounds.top) / scaleY };
    const walker = doc.createTreeWalker(layer, 4 /* SHOW_TEXT */);
    const probe = doc.createRange();
    while (walker.nextNode()) {
      if (++visited > MAX_NODES) {
        if (!text) return unavailable("scan-limit");
        return { text, state: { status: "available", source: "pdf-text-layer", truncated: true, reason: "scan-limit" } };
      }
      const node = walker.currentNode;
      if (!node.textContent?.trim()) continue;
      const parent = node.parentElement;
      if (!parent || doc.defaultView?.getComputedStyle(parent).visibility === "hidden") continue;
      probe.selectNodeContents(node);
      if (!Array.from(probe.getClientRects()).some(box => intersects(local, box))) continue;
      const remaining = MAX_CHARS - text.length - (text ? 1 : 0);
      const value = node.textContent;
      if (remaining <= 0) { truncated = true; break; }
      text += (text ? " " : "") + prefix(value, remaining);
      if (value.length > remaining) { truncated = true; break; }
    }
    if (truncated) break;
  }
  if (!layers) return unavailable(hasPdf ? "not-visible" : "unsupported");
  // Never mix one ready page with a still-rendering page of the same spread.
  if (pending) return unavailable("not-ready");
  return { text, state: { status: text.trim() ? "available" : "empty", source: "pdf-text-layer", truncated } };
}

/** Uses only already-rendered content; never loads another section or performs OCR.
 * PDF clipping is at text-run granularity, not individual glyphs or overlay occlusion. */
export function readingVisibleText(view: FoliateView): ReadingVisibleText {
  try { return read(view); }
  catch (error) { log.warn("Could not read the current rendered text", error); return unavailable("read-failed"); }
}
