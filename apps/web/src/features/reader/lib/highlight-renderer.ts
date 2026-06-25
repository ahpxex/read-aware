import type { Highlight } from "../../annotations/lib/annotation-types";
import type { FoliateAnnotation, FoliateDrawAnnotationDetail, FoliateView } from "./foliate-engine";
import { loadDrawFns } from "./foliate-engine";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Swatch colors shown in the annotation menus (translucent, look right as dots). */
export const HIGHLIGHT_COLORS: Record<Highlight["color"], string> = {
  yellow: "rgba(250, 204, 21, 0.35)",
  green: "rgba(74, 222, 128, 0.30)",
  blue: "rgba(96, 165, 250, 0.30)",
  pink: "rgba(251, 113, 133, 0.30)",
};

/**
 * Solid fills handed to foliate's overlayer for highlights. The overlayer applies
 * its own ~0.3 opacity, so a solid color reads as a soft highlight (passing the
 * translucent swatch rgba would double up and look washed out).
 */
const HIGHLIGHT_FILL: Record<Highlight["color"], string> = {
  yellow: "#facc15",
  green: "#4ade80",
  blue: "#60a5fa",
  pink: "#fb7185",
};

/** Saturated strokes for underlines — a thin rule needs more weight than a fill. */
const UNDERLINE_STROKE: Record<Highlight["color"], string> = {
  yellow: "#eab308",
  green: "#22c55e",
  blue: "#3b82f6",
  pink: "#ec4899",
};

/**
 * Custom underline for the `draw-annotation` event, in place of foliate's blunt
 * filled rule. A thin, round-capped, slightly translucent stroke sitting just
 * under the text reads as a quiet hand-drawn underline rather than a solid bar.
 * Runs in the app's document context (where the overlay SVG lives).
 */
function drawUnderline(
  rects: Iterable<DOMRect>,
  options: { color?: string } = {},
): SVGGElement {
  const { color = UNDERLINE_STROKE.yellow } = options;
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("fill", "none");
  group.setAttribute("stroke", color);
  group.setAttribute("stroke-width", "2.5");
  group.setAttribute("stroke-linecap", "round");
  group.style.opacity = "0.9";
  for (const rect of rects) {
    if (rect.width < 1) continue;
    // Sit a little below the text (not hugging the descenders) so the slightly
    // heavier rule reads as a clear underline rather than a strikethrough.
    const y = rect.bottom - Math.min(5, rect.height * 0.16);
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(rect.left + 0.75));
    line.setAttribute("y1", String(y));
    line.setAttribute("x2", String(rect.right - 0.75));
    line.setAttribute("y2", String(y));
    group.append(line);
  }
  return group;
}

function toFoliateAnnotation(highlight: Highlight): FoliateAnnotation | null {
  if (!highlight.cfiRange) return null;
  const isUnderline = highlight.style === "underline";
  const color = isUnderline
    ? UNDERLINE_STROKE[highlight.color] ?? UNDERLINE_STROKE.yellow
    : HIGHLIGHT_FILL[highlight.color] ?? HIGHLIGHT_FILL.yellow;
  return {
    value: highlight.cfiRange,
    color,
    id: highlight.id,
    style: isUnderline ? "underline" : "highlight",
  };
}

/** Draw one stored mark (no-op if its CFI is not in a loaded section). */
export function applyHighlight(view: FoliateView, highlight: Highlight): void {
  const annotation = toFoliateAnnotation(highlight);
  if (!annotation) return;
  void view.addAnnotation(annotation).catch(() => {
    // CFI may not resolve in the current layout — foliate ignores it.
  });
}

export function applyHighlights(view: FoliateView, highlights: Highlight[]): void {
  for (const highlight of highlights) applyHighlight(view, highlight);
}

export function removeHighlight(view: FoliateView, cfiRange: string): void {
  void view.deleteAnnotation({ value: cfiRange }).catch(() => {
    // Ignore removal errors (e.g. section not currently rendered).
  });
}

/**
 * Wire the `draw-annotation` event once per view so foliate paints our marks:
 * a filled highlight or a custom underline rule, chosen per annotation. Must be
 * registered before any annotations are added.
 */
export async function registerHighlightDrawing(view: FoliateView): Promise<void> {
  const { highlight } = await loadDrawFns();
  view.addEventListener("draw-annotation", (event) => {
    const detail = (event as CustomEvent<FoliateDrawAnnotationDetail>).detail;
    const drawFn = detail.annotation.style === "underline" ? drawUnderline : highlight;
    detail.draw(drawFn, { color: detail.annotation.color });
  });
}
