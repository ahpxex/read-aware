import type { Highlight, Note } from "../../annotations/lib/annotation-types";
import type { FoliateAnnotation, FoliateDrawAnnotationDetail, FoliateView } from "./foliate-engine";
import { loadDrawFns } from "./foliate-engine";

const SVG_NS = "http://www.w3.org/2000/svg";
const NAVIGATOR_OVERLAY_PREFIX = "read-aware:navigator:";

const navigatorOverlayKey = (cfiRange: string) => `${NAVIGATOR_OVERLAY_PREFIX}${cfiRange}`;
const NOTE_OVERLAY_PREFIX = "read-aware:note:";
/** A noted passage's dashed line has its own overlay layer, so it shows beside
 *  a highlight or underline on the same range instead of giving way to it. */
export const noteOverlayKey = (cfiRange: string) => `${NOTE_OVERLAY_PREFIX}${cfiRange}`;

/** A note's marks are neutral stone — quietly distinct from the mark colors. */
const NOTE_STROKE = "#78716c";

/** The text-unit mode's resting wash — monochrome stone, not a mark color,
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

/**
 * Saturated strokes for thin marks — underlines, and the rule beside a
 * highlight in an annotation list. A thin line needs more weight than a fill.
 */
export const UNDERLINE_STROKE: Record<Highlight["color"], string> = {
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
function drawUnderline(rects: Iterable<DOMRect>, options: { color?: string } = {}): SVGGElement {
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

/**
 * A noted passage: a dashed line under its whole extent, on its own layer so
 * a highlight or underline on the same words never hides it. It sits a step
 * lower than an underline's rule (see `drawUnderline`), so an underlined and
 * noted passage shows both lines stacked, never one over the other.
 */
function drawNote(rects: Iterable<DOMRect>, options: { color?: string; writingMode?: string } = {}): SVGGElement {
  const { color = NOTE_STROKE, writingMode = "horizontal-tb" } = options;
  const vertical = writingMode.startsWith("vertical");
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("fill", "none");
  group.setAttribute("stroke", color);
  group.setAttribute("stroke-width", "1.75");
  group.setAttribute("stroke-linecap", "round");
  group.setAttribute("stroke-dasharray", "3 3.5");
  for (const rect of rects) {
    if (rect.width < 1 || rect.height < 1) continue;
    const line = document.createElementNS(SVG_NS, "line");
    if (vertical) {
      // Vertical text: the line runs beside the column, on the side an underline takes.
      const x = rect.right - 0.5;
      line.setAttribute("x1", String(x));
      line.setAttribute("y1", String(rect.top + 0.75));
      line.setAttribute("x2", String(x));
      line.setAttribute("y2", String(rect.bottom - 0.75));
    } else {
      // An underline's rule sits about four pixels up from the box's bottom; this sits at the bottom.
      const y = rect.bottom - 0.5;
      line.setAttribute("x1", String(rect.left + 0.75));
      line.setAttribute("y1", String(y));
      line.setAttribute("x2", String(rect.right - 0.75));
      line.setAttribute("y2", String(y));
    }
    group.append(line);
  }
  return group;
}

/** How strongly the focus veil washes the surrounding text toward the page
 *  color. Tuned visually: context stays readable, the resting unit just
 *  reads a clear step brighter. */
const VEIL_OPACITY = "0.6";
/** The veil's outer bounds — far past any section's layout, so one fixed
 *  path covers the whole overlay without measuring it. */
const VEIL_EXTENT = 1e6;

/** Add breathing room only on the block axis. A following sentence can start
 * exactly at `rect.right`, so inline padding would wash its first glyph too. */
export function navigatorLineBox(
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  blockPadding: number,
  writingMode = "horizontal-tb",
): { x: number; y: number; width: number; height: number } {
  if (/^(vertical|sideways)-/.test(writingMode)) {
    return {
      x: rect.left - blockPadding,
      y: rect.top,
      width: rect.width + blockPadding * 2,
      height: rect.height,
    };
  }
  return {
    x: rect.left,
    y: rect.top - blockPadding,
    width: rect.width,
    height: rect.height + blockPadding * 2,
  };
}

/**
 * The dimming veil around the active unit: one page-toned translucent path
 * covering everything except windows over the unit's line boxes. The
 * overlay SVG paints above the text, so the fill reads as the text fading into
 * the page. Windows are cut with counterclockwise subpaths under the nonzero
 * fill rule — overlapping line boxes merge instead of XOR-ing back to filled
 * (which fill-rule="evenodd" would do).
 */
function drawNavigatorVeil(rects: DOMRect[], color: string, writingMode: string): SVGPathElement {
  let d = `M ${-VEIL_EXTENT} ${-VEIL_EXTENT} H ${VEIL_EXTENT} V ${VEIL_EXTENT} H ${-VEIL_EXTENT} Z`;
  for (const rect of rects) {
    const { x, y, width, height } = navigatorLineBox(rect, 2, writingMode);
    d += ` M ${x} ${y} v ${height} h ${width} v ${-height} Z`;
  }
  const veil = document.createElementNS(SVG_NS, "path");
  veil.setAttribute("d", d);
  veil.setAttribute("fill", color);
  veil.setAttribute("fill-rule", "nonzero");
  veil.style.opacity = VEIL_OPACITY;
  return veil;
}

/**
 * The text-unit mode's current-target wash: soft rounded rects behind the
 * text. Deliberately quieter than a highlight (lower opacity, stone tint) —
 * it marks a reading position, not saved content. When a veil color is given
 * (the reader's page color), everything around the unit is additionally
 * washed toward the page so the resting unit carries the focus.
 */
function drawNavigatorTarget(
  rects: Iterable<DOMRect>,
  options: { color?: string; writingMode?: string } = {},
): SVGGElement {
  const { color: veilColor, writingMode = "horizontal-tb" } = options;
  const group = document.createElementNS(SVG_NS, "g");
  const lineRects = Array.from(rects).filter((rect) => rect.width >= 1);
  // No line boxes to spare; drawing the veil would dim the target itself.
  if (veilColor && lineRects.length) {
    group.append(drawNavigatorVeil(lineRects, veilColor, writingMode));
  }
  const wash = document.createElementNS(SVG_NS, "g");
  wash.setAttribute("fill", NAVIGATOR_FILL);
  wash.style.opacity = "0.25";
  for (const rect of lineRects) {
    const box = navigatorLineBox(rect, 1, writingMode);
    const el = document.createElementNS(SVG_NS, "rect");
    el.setAttribute("x", String(box.x));
    el.setAttribute("y", String(box.y));
    el.setAttribute("width", String(box.width));
    el.setAttribute("height", String(box.height));
    el.setAttribute("rx", "3");
    wash.append(el);
  }
  group.append(wash);
  return group;
}

function toFoliateAnnotation(highlight: Highlight): FoliateAnnotation | null {
  if (!highlight.cfiRange) return null;
  const isUnderline = highlight.style === "underline";
  const color = isUnderline
    ? (UNDERLINE_STROKE[highlight.color] ?? UNDERLINE_STROKE.yellow)
    : (HIGHLIGHT_FILL[highlight.color] ?? HIGHLIGHT_FILL.yellow);
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
  const painted = new Set<string>();
  for (const highlight of highlights) {
    if (!highlight.cfiRange || painted.has(highlight.cfiRange)) continue;
    painted.add(highlight.cfiRange);
    applyHighlight(view, highlight);
  }
}

export function removeHighlight(view: FoliateView, cfiRange: string): void {
  void view.deleteAnnotation({ value: cfiRange }).catch(() => {
    // Ignore removal errors (e.g. section not currently rendered).
  });
}

/** A note's dashed line, on its own layer beside whatever marks the same words. */
function noteMark(note: Note): FoliateAnnotation | null {
  if (!note.cfiRange) return null;
  return {
    value: note.cfiRange,
    overlayKey: noteOverlayKey(note.cfiRange),
    id: note.id,
    color: NOTE_STROKE,
    style: "note",
  };
}

/** Draw every noted passage's dashed line (on its own layer, beside any mark). */
export function applyNotes(view: FoliateView, notes: Note[], highlights: Highlight[]): void {
  for (const mark of marksFor([...highlights, ...notes]).values()) {
    if (mark.style !== "note") continue;
    void view.addAnnotation(mark).catch(() => {
      // CFI may not resolve in the current layout — foliate ignores it.
    });
  }
}

/** The marks each anchored range shows for a set of stored annotations, keyed
 *  by overlay: a highlight or underline owns its range's mark, and every noted
 *  range adds its dashed line on a layer of its own. */
function marksFor(items: ReadonlyArray<Highlight | Note>): Map<string, FoliateAnnotation> {
  const marks = new Map<string, FoliateAnnotation>();
  for (const item of items) {
    if (item.type !== "highlight") continue;
    const mark = toFoliateAnnotation(item);
    if (mark && !marks.has(mark.value)) marks.set(mark.value, mark);
  }
  for (const item of items) {
    if (item.type !== "note") continue;
    const mark = noteMark(item);
    if (mark && !marks.has(mark.overlayKey!)) marks.set(mark.overlayKey!, mark);
  }
  return marks;
}

const sameMark = (a: FoliateAnnotation | undefined, b: FoliateAnnotation) =>
  !!a &&
  a.value === b.value &&
  a.overlayKey === b.overlayKey &&
  a.id === b.id &&
  a.color === b.color &&
  a.style === b.style;

/** Bring the drawn marks from `previous` to `next`: remove anchors that lost
 *  their mark, paint anchors whose mark is new or changed, and leave unchanged
 *  marks alone. Each engine paint resolves a CFI and redraws, so a book with
 *  many marks must not repaint them all for one new highlight; documents that
 *  load later receive every mark through overlay recreation instead. */
export async function reconcileAnnotationMarks(
  view: Pick<FoliateView, "addAnnotation" | "deleteAnnotation">,
  previous: Array<Highlight | Note>,
  next: Array<Highlight | Note>,
  signal: AbortSignal,
  report: (error: unknown) => void,
): Promise<void> {
  const drawn = marksFor(previous),
    desired = marksFor(next);
  for (const [key, mark] of drawn) {
    if (signal.aborted) return;
    if (!desired.has(key)) {
      try {
        await view.deleteAnnotation(
          mark.overlayKey ? { value: mark.value, overlayKey: mark.overlayKey } : { value: mark.value },
        );
      } catch (error) {
        if (!signal.aborted) report(error);
      }
    }
  }
  for (const [key, mark] of desired) {
    if (signal.aborted) return;
    if (sameMark(drawn.get(key), mark)) continue;
    try {
      await view.addAnnotation(mark);
    } catch (error) {
      if (!signal.aborted) report(error);
    }
  }
}

/**
 * Draw the active text unit's wash at `cfiRange`, plus,
 * when `veilColor` (the reader's page color) is given, the dimming veil over
 * everything else. Rendered through the same overlayer as marks, so it follows
 * the text through page turns, scrolling, and re-layout for free.
 */
export function applyNavigatorHighlight(view: FoliateView, cfiRange: string, veilColor?: string): void {
  void view
    .addAnnotation({
      value: cfiRange,
      overlayKey: navigatorOverlayKey(cfiRange),
      style: "navigator",
      color: veilColor,
    })
    .catch(() => {
      // CFI may not resolve in the current layout — foliate ignores it.
    });
}

export function removeNavigatorHighlight(view: FoliateView, cfiRange: string): void {
  void view.deleteAnnotation({ value: cfiRange, overlayKey: navigatorOverlayKey(cfiRange) }).catch(() => {
    // Ignore removal errors (e.g. section not currently rendered).
  });
}

/**
 * Wire the `draw-annotation` event once per view so foliate paints each
 * annotation by style: a filled highlight, a solid underline rule, a dashed
 * note marker, or the text-unit mode's wash. Must be registered before any
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
            ? drawNavigatorTarget
            : highlight;
    const container = detail.range.commonAncestorContainer;
    const element = container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement;
    const writingMode = element ? detail.doc.defaultView?.getComputedStyle(element).writingMode : undefined;
    detail.draw(drawFn, { color: detail.annotation.color, writingMode });
  });
}
