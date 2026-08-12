/**
 * Click-to-view eligibility for images inside book sections (issue #13).
 * Decides whether a tap landed on a real illustration — as opposed to an
 * inline ornament, a footnote marker, or a linked image — and resolves the
 * URL the top-document viewer can load.
 */

/**
 * Below this rendered box the image reads as an inline icon or ornament
 * (drop caps, dividers, publisher logos), not an illustration worth a viewer.
 */
const MIN_ACTIVATION_PX = 80;

export type ActivatedImage = {
  src: string;
  alt: string | null;
};

function imageSource(element: Element): string | null {
  // Realm check by localName, not instanceof: section elements live in the
  // foliate iframe's realm, where `HTMLImageElement` is a different constructor.
  if (element.localName === "img") {
    const img = element as HTMLImageElement;
    return img.currentSrc || img.src || null;
  }
  // SVG <image> (EPUB cover pages wrap the cover this way). foliate rewrites
  // the href to a blob URL; a still-relative one resolves against the section.
  const href =
    element.getAttribute("href") ?? element.getAttribute("xlink:href");
  if (!href) return null;
  try {
    return new URL(href, element.ownerDocument.baseURI).toString();
  } catch {
    return null;
  }
}

/** The illustration a click activated, or null when the tap is not ours. */
export function resolveActivatedImage(target: EventTarget | null): ActivatedImage | null {
  // Duck-typed Element check — `instanceof Element` is realm-bound and the
  // click target belongs to the section iframe's realm, not ours.
  if (!target || typeof (target as Element).closest !== "function") return null;
  const element = (target as Element).closest("img, image");
  if (!element) return null;
  // Footnote markers are images too; their own intercept runs first, but keep
  // the guard in case a book marks them without triggering that handler.
  if (
    element.hasAttribute("zy-footnote") ||
    element.classList.contains("epub-footnote") ||
    element.classList.contains("zhangyue-footnote")
  ) {
    return null;
  }
  // A linked image is a control (footnote return, external reference): the
  // link's own behavior wins over the viewer.
  if (element.closest("a[href]")) return null;

  const rect = element.getBoundingClientRect();
  if (rect.width < MIN_ACTIVATION_PX || rect.height < MIN_ACTIVATION_PX) {
    return null;
  }

  const src = imageSource(element);
  if (!src) return null;
  const alt = element.getAttribute("alt")?.trim() || null;
  return { src, alt };
}
