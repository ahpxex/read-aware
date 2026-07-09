export type SelectionOverlayRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ReaderSelectionAppearance =
  | "selection"
  | "highlight"
  | "underline"
  | "note";

export type ReaderSelectionState = {
  anchorRect: SelectionOverlayRect | null;
  appearance: ReaderSelectionAppearance;
  cfiRange: string | null;
  chapterHref: string | null;
  rects: SelectionOverlayRect[];
  text: string;
  /** The passage the selection sits in (windowed), for a context-aware lookup. */
  context?: string;
};

const MIN_RECT_SIDE = 1;

export function getNormalizedSelectionText(selection: Selection | null) {
  return selection?.toString().replace(/\s+/g, " ").trim() ?? "";
}

/**
 * The containing block's text, windowed around the selection — handed to the
 * AI dictionary so a single word can be read in context. Returns `undefined`
 * when the block adds nothing beyond the selected text itself.
 */
export function getSelectionContext(range: Range, selectedText: string): string | undefined {
  const start = range.startContainer;
  const el = start.nodeType === Node.TEXT_NODE ? start.parentElement : (start as Element | null);
  const block =
    el?.closest?.("p, li, blockquote, dd, figcaption, h1, h2, h3, h4, h5, h6") ?? el;
  const raw = (block?.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!raw || raw === selectedText) return undefined;

  const MAX = 600;
  if (raw.length <= MAX) return raw;
  // Window ±half around the selection so a long paragraph stays bounded.
  const idx = raw.indexOf(selectedText);
  if (idx === -1) return raw.slice(0, MAX);
  const half = Math.floor((MAX - selectedText.length) / 2);
  const from = Math.max(0, idx - half);
  const to = Math.min(raw.length, idx + selectedText.length + half);
  return `${from > 0 ? "…" : ""}${raw.slice(from, to).trim()}${to < raw.length ? "…" : ""}`;
}

export function getSelectionOverlayRects(range: Range) {
  return Array.from(range.getClientRects())
    .filter((rect) => rect.width > MIN_RECT_SIDE && rect.height > MIN_RECT_SIDE)
    .map<SelectionOverlayRect>((rect) => ({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    }));
}
