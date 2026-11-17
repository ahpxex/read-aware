/**
 * Zhangyue-style inline footnotes: an image marker that carries its note in an
 * attribute (<img zy-footnote="note" class="epub-footnote">). The reader shows
 * the note on click, the reader stylesheet keeps the marker text-sized, and the
 * library's image and reference queries treat it as a note, never an
 * illustration. Supporting another vendor's marker is a change here only.
 */
const MARKER = "[zy-footnote], .epub-footnote, .zhangyue-footnote";

/** Inline footnote marker images. */
export const INLINE_FOOTNOTE_SELECTOR = "img[zy-footnote], img.epub-footnote, img.zhangyue-footnote";

/** Images that are not inline footnote markers. */
export const NON_FOOTNOTE_IMAGE_SELECTOR = "img:not([zy-footnote]):not(.epub-footnote):not(.zhangyue-footnote)";

export const isInlineFootnote = (element: Element): boolean => element.matches(MARKER);

/** The note an inline footnote marker carries. */
export const inlineFootnoteText = (element: Element): string =>
  (element.getAttribute("zy-footnote") ?? element.getAttribute("alt") ?? "").trim();
