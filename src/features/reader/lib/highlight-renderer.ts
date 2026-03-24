import type { Highlight } from "../../annotations/lib/annotation-types";
import type { EpubRendition } from "./epub-types";

export const HIGHLIGHT_COLORS: Record<Highlight["color"], string> = {
  yellow: "rgba(250, 204, 21, 0.35)",
  green: "rgba(74, 222, 128, 0.30)",
  blue: "rgba(96, 165, 250, 0.30)",
  pink: "rgba(251, 113, 133, 0.30)",
};

export function applyHighlight(rendition: EpubRendition, highlight: Highlight): void {
  const color = HIGHLIGHT_COLORS[highlight.color] ?? HIGHLIGHT_COLORS.yellow;
  try {
    rendition.annotations.highlight(
      highlight.cfiRange ?? "",
      { id: highlight.id },
      undefined,
      undefined,
      { fill: color, "fill-opacity": "1", "mix-blend-mode": "multiply" },
    );
  } catch {
    // CFI may not match current section -- epub.js silently ignores these
  }
}

export function applyHighlights(rendition: EpubRendition, highlights: Highlight[]): void {
  for (const highlight of highlights) {
    if (highlight.cfiRange) {
      applyHighlight(rendition, highlight);
    }
  }
}

export function removeHighlight(rendition: EpubRendition, cfiRange: string): void {
  try {
    rendition.annotations.remove(cfiRange, "highlight");
  } catch {
    // Ignore removal errors
  }
}
