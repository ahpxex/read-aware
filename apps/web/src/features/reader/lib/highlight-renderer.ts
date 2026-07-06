import type { Highlight, Note } from "../../annotations/lib/annotation-types";
import type { FoliateAnnotation, FoliateDrawAnnotationDetail, FoliateView } from "./foliate-engine";
import { loadDrawFns } from "./foliate-engine";

const SVG_NS = "http://www.w3.org/2000/svg";

/** A note's marker is a neutral dashed underline — quietly distinct from marks. */
const NOTE_STROKE = "#78716c";

/** The sentence navigator's resting wash — monochrome stone, not a mark color,
 *  so it can't be mistaken for a saved highlight. */
const NAVIGATOR_FILL = "#a8a29e";

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

/** A noted passage's marker: a dashed underline, quietly set apart from marks. */
function drawNote(
  rects: Iterable<DOMRect>,
  options: { color?: string } = {},
): SVGGElement {
  const { color = NOTE_STROKE } = options;
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("fill", "none");
  group.setAttribute("stroke", color);
  group.setAttribute("stroke-width", "2");
  group.setAttribute("stroke-linecap", "round");
  group.setAttribute("stroke-dasharray", "2 3.5");
  group.style.opacity = "0.85";
  for (const rect of rects) {
    if (rect.width < 1) continue;
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

/**
 * The sentence navigator's current-sentence wash: soft rounded rects behind the
 * text. Deliberately quieter than a highlight (lower opacity, stone tint) —
 * it marks a reading position, not saved content.
 */
function drawNavigatorSentence(
  rects: Iterable<DOMRect>,
  options: { color?: string } = {},
): SVGGElement {
  const { color = NAVIGATOR_FILL } = options;
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("fill", color);
  group.style.opacity = "0.25";
  for (const rect of rects) {
    if (rect.width < 1) continue;
    const el = document.createElementNS(SVG_NS, "rect");
    el.setAttribute("x", String(rect.left - 2));
    el.setAttribute("y", String(rect.top - 1));
    el.setAttribute("width", String(rect.width + 4));
    el.setAttribute("height", String(rect.height + 2));
    el.setAttribute("rx", "3");
    group.append(el);
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

/** Draw one note's dashed marker (no-op if its CFI is not in a loaded section). */
export function applyNote(view: FoliateView, note: Note): void {
  if (!note.cfiRange) return;
  void view
    .addAnnotation({ value: note.cfiRange, color: NOTE_STROKE, id: note.id, style: "note" })
    .catch(() => {
      // CFI may not resolve in the current layout — foliate ignores it.
    });
}

/**
 * Draw note markers, skipping any note whose range is already highlighted: the
 * highlight is the visual there, and foliate's overlayer keys by CFI so a note
 * and a mark can't share one range. (The note stays reachable from the mark's
 * menu.)
 */
export function applyNotes(view: FoliateView, notes: Note[], highlights: Highlight[]): void {
  const highlighted = new Set(
    highlights.map((highlight) => highlight.cfiRange).filter(Boolean),
  );
  for (const note of notes) {
    if (!note.cfiRange || highlighted.has(note.cfiRange)) continue;
    applyNote(view, note);
  }
}

/**
 * Draw the sentence navigator's wash over the sentence at `cfiRange`. Rendered
 * through the same overlayer as marks, so it follows the text through page
 * turns, scrolling, and re-layout for free.
 */
export function applyNavigatorHighlight(view: FoliateView, cfiRange: string): void {
  void view
    .addAnnotation({ value: cfiRange, style: "navigator" })
    .catch(() => {
      // CFI may not resolve in the current layout — foliate ignores it.
    });
}

export function removeNavigatorHighlight(view: FoliateView, cfiRange: string): void {
  void view.deleteAnnotation({ value: cfiRange }).catch(() => {
    // Ignore removal errors (e.g. section not currently rendered).
  });
}

/**
 * Wire the `draw-annotation` event once per view so foliate paints each
 * annotation by style: a filled highlight, a solid underline rule, a dashed
 * note marker, or the navigator's sentence wash. Must be registered before any
 * annotations are added.
 */
export async function registerHighlightDrawing(view: FoliateView): Promise<void> {
  const { highlight } = await loadDrawFns();
  view.addEventListener("draw-annotation", (event) => {
    const detail = (event as CustomEvent<FoliateDrawAnnotationDetail>).detail;
    const style = detail.annotation.style;
    const drawFn =
      style === "underline"
        ? drawUnderline
        : style === "note"
          ? drawNote
          : style === "navigator"
            ? drawNavigatorSentence
            : highlight;
    detail.draw(drawFn, { color: detail.annotation.color });
  });
}
