const mediaSelector = "img, svg, video, canvas";

// Publishers wrap full-page artwork in anything from a div to a layout table.
// Identify the document without removing nodes: their positions are CFI anchors.
export const isImageOnlyDocument = (doc: Document): boolean => {
  const media = Array.from(doc.body.querySelectorAll(mediaSelector)).filter(
    (el) => !el.parentElement?.closest(mediaSelector),
  );
  if (media.length !== 1) return false;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_CDATA_SECTION);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.trim() && !node.parentElement?.closest(`${mediaSelector}, script, style`)) return false;
  }
  return true;
};

/** Block spacing of a containing block and everything around it, by element: one sizing pass's memo. */
export type BlockSpacing = Map<Element, number>;

// The paginator's height already excludes its outer page margin. Reserve the
// image's own margins and its containing blocks' spacing inside that height.
// Do not use bounding boxes: a fragmented image reports pieces on several pages.
// `known` carries the containing blocks already summed in this pass: images
// share most of their ancestors, and each is read once.
export const imageBlockSpacing = (el: Element, win: Window, known: BlockSpacing = new Map()): number => {
  const pixels = (value: string) => Number.parseFloat(value) || 0;
  const root = el.ownerDocument.documentElement;
  const around = (parent: Element | null): number => {
    if (!parent || parent === root) return 0;
    let spacing = known.get(parent);
    if (spacing === undefined) {
      const css = win.getComputedStyle(parent);
      spacing =
        pixels(css.paddingTop) +
        pixels(css.paddingBottom) +
        pixels(css.borderTopWidth) +
        pixels(css.borderBottomWidth) +
        pixels(css.marginTop) +
        pixels(css.marginBottom) +
        around(parent.parentElement);
      known.set(parent, spacing);
    }
    return spacing;
  };
  const style = win.getComputedStyle(el);
  return pixels(style.marginTop) + pixels(style.marginBottom) + around(el.parentElement);
};
