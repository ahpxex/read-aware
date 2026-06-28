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
};

const MIN_RECT_SIDE = 1;

export function getNormalizedSelectionText(selection: Selection | null) {
  return selection?.toString().replace(/\s+/g, " ").trim() ?? "";
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
