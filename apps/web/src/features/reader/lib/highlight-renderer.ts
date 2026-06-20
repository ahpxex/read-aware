import type { Highlight } from "../../annotations/lib/annotation-types";
import type { FoliateAnnotation, FoliateDrawAnnotationDetail, FoliateView } from "./foliate-engine";
import { loadHighlightDrawFn } from "./foliate-engine";

/** Swatch colors shown in the selection menu (translucent, look right as dots). */
export const HIGHLIGHT_COLORS: Record<Highlight["color"], string> = {
  yellow: "rgba(250, 204, 21, 0.35)",
  green: "rgba(74, 222, 128, 0.30)",
  blue: "rgba(96, 165, 250, 0.30)",
  pink: "rgba(251, 113, 133, 0.30)",
};

/**
 * Solid fills handed to foliate's overlayer. The overlayer applies its own
 * ~0.3 opacity, so a solid color reads as a soft highlight (passing the
 * translucent swatch rgba would double up and look washed out).
 */
const HIGHLIGHT_FILL: Record<Highlight["color"], string> = {
  yellow: "#facc15",
  green: "#4ade80",
  blue: "#60a5fa",
  pink: "#fb7185",
};

function toFoliateAnnotation(highlight: Highlight): FoliateAnnotation | null {
  if (!highlight.cfiRange) return null;
  return {
    value: highlight.cfiRange,
    color: HIGHLIGHT_FILL[highlight.color] ?? HIGHLIGHT_FILL.yellow,
    id: highlight.id,
  };
}

/** Draw one stored highlight (no-op if its CFI is not in a loaded section). */
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
 * Wire the `draw-annotation` event once per view so foliate actually paints our
 * highlights with the right fill. Must be registered before highlights are added.
 */
export async function registerHighlightDrawing(view: FoliateView): Promise<void> {
  const highlightFn = await loadHighlightDrawFn();
  view.addEventListener("draw-annotation", (event) => {
    const detail = (event as CustomEvent<FoliateDrawAnnotationDetail>).detail;
    detail.draw(highlightFn, { color: detail.annotation.color });
  });
}
