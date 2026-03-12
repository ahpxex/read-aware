export type SelectionOverlayRect = {
  left: number;
  top: number;
  width: number;
  height: number;
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

export function paintSelectionOverlay(
  root: HTMLElement,
  ownerDocument: Document,
  rects: SelectionOverlayRect[],
  rectClassName: string,
) {
  root.replaceChildren();

  if (rects.length === 0) return;

  const fragment = ownerDocument.createDocumentFragment();

  for (const rect of rects) {
    const element = ownerDocument.createElement("div");
    element.className = rectClassName;
    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top}px`;
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
    fragment.append(element);
  }

  root.append(fragment);
}
