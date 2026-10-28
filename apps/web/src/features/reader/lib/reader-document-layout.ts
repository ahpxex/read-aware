import type { Book, ResolvedNavigation } from "../../../../foliate-js/src/book";
import type { ChapterMap } from "../../../../foliate-js/src/chapter-map";

const chapterBlocks = "h1, h2, h3, h4, h5, h6, p, section, article, div";
type ChapterStarts = ReadonlyMap<number, readonly ResolvedNavigation[]>;

export function readerChapterBlock(target: Node): Element | null {
  const element = target.nodeType === 1 ? (target as Element) : target.parentElement;
  return element?.closest(chapterBlocks) ?? element;
}

/** The chapter map's starts, grouped by spine section for the paginator. Zero
 * (and an omitted anchor) means the start of a source document; it is kept, or
 * unrelated chapters merge into one ever-growing scroll view. Fixed layouts
 * have pages, not chapter windows. */
export function readerChapterStarts(book: Pick<Book, "rendition">, map: ChapterMap): ChapterStarts {
  const starts = new Map<number, ResolvedNavigation[]>();
  if (book.rendition?.layout === "pre-paginated") return starts;
  for (const { target } of map.chapters) {
    const group = starts.get(target.index) ?? [];
    group.push(target);
    starts.set(target.index, group);
  }
  return starts;
}

export function markReaderChapterStarts(doc: Document, index: number, starts: ChapterStarts): void {
  for (const { anchor } of starts.get(index) ?? []) {
    const target = typeof anchor === "function" ? anchor(doc) : anchor;
    if (!target || typeof target === "number") continue;
    const node = "startContainer" in target ? target.startContainer : target;
    // Keep a standalone empty anchor with its following heading. Moving only
    // the heading to a new column leaves TOC navigation on the previous page.
    const block = readerChapterBlock(node);
    if (!block || block === doc.body || !doc.body.contains(block)) continue;
    const before = doc.createRange();
    before.selectNodeContents(doc.body);
    before.setEndBefore(block);
    const hasPrevious =
      !!before.toString().trim() ||
      Array.from(doc.body.querySelectorAll("img, svg, video, canvas")).some(
        (image) => !!(image.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING),
      );
    block.setAttribute("data-ra-chapter-start", hasPrevious ? "next" : "first");
  }
}

const mediaElements = "img, svg, video, canvas";

/** Publisher glyph substitutes ("补字图" images standing in for a rare
 * character) and inline icons share a line with real text; the reader
 * stylesheet's block illustration treatment would tear the sentence into
 * centered strips and discard their em-based sizing (height: 1em,
 * vertical-align). Media on a text line is marked with data-ra-inline-media
 * so the publisher's CSS governs it; standalone artwork keeps the block
 * rules. Runs on load like the other markers and stays idempotent. */
export function markReaderInlineMedia(doc: Document): void {
  const win = doc.defaultView;
  if (!win || !doc.body) return;
  const styles = new Map<Element, CSSStyleDeclaration>();
  const style = (el: Element) => {
    let value = styles.get(el);
    if (!value) {
      value = win.getComputedStyle(el);
      styles.set(el, value);
    }
    return value;
  };
  const inlineLevel = (el: Element) => {
    const display = style(el).display;
    return display === "contents" || display.startsWith("inline") || display.startsWith("ruby");
  };
  for (const el of doc.body.querySelectorAll(mediaElements)) {
    if (el.parentElement?.closest("svg")) {
      el.removeAttribute("data-ra-inline-media");
      continue;
    }
    // The containing block: nearest ancestor outside the element's own inline
    // formatting context (display: contents generates no box, so it is not one).
    let block: Element | null = el.parentElement;
    while (block && block !== doc.body && inlineLevel(block)) block = block.parentElement;
    let inline = false;
    if (block) {
      // Split the block's inline flow at line boundaries — <br> and nested
      // non-inline-level boxes — and check whether the segment containing the
      // media element carries non-whitespace text.
      let segment = 0;
      let mediaSegment = -1;
      let hasText = false;
      let done = false;
      const boundary = () => {
        if (mediaSegment < 0) {
          segment++;
          hasText = false;
        } else done = true;
      };
      const visit = (parent: Element) => {
        for (const node of parent.childNodes) {
          if (done) return;
          if (node.nodeType === Node.TEXT_NODE) {
            // Text inside media (svg glyphs, video fallback) or script/style
            // is not line text; trim() also drops bare &nbsp; runs.
            if (!node.parentElement?.closest("svg, video, canvas, script, style") && node.textContent?.trim()) {
              hasText = true;
              if (segment === mediaSegment) inline = true;
            }
            continue;
          }
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const element = node as Element;
          if (element === el) {
            mediaSegment = segment;
            inline = hasText;
          } else if (
            element.tagName === "BR" ||
            (!element.matches(`${mediaElements}, script, style`) && !inlineLevel(element))
          ) {
            boundary();
          } else if (!element.matches(mediaElements)) {
            // Inline-level content joins the line; other media are line
            // participants themselves, not boundaries.
            visit(element);
          }
        }
      };
      visit(block);
    }
    el.toggleAttribute("data-ra-inline-media", inline);
  }
}

const scriptOrGraphic = "sup, sub, rt, rp, svg, math, pre, code, kbd, samp";

/** Keep publisher emphasis and larger type, but do not let malformed relative
 * sizes make reading text microscopic. Measure before writing any markers so
 * nested spans cannot compound the correction. Called after each stylesheet. */
export function normalizeReaderTextSizes(doc: Document): void {
  const win = doc.defaultView;
  if (!win || !doc.body) return;
  for (const el of doc.querySelectorAll("[data-ra-small-text]")) el.removeAttribute("data-ra-small-text");
  const minimum = parseFloat(win.getComputedStyle(doc.body).fontSize) * 0.85;
  if (!Number.isFinite(minimum) || minimum <= 0) return;
  const parents = new Set<Element>();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_CDATA_SECTION);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.trim() && node.parentElement) parents.add(node.parentElement);
  }
  const styles = new Map<Element, CSSStyleDeclaration>();
  const style = (el: Element) => {
    let value = styles.get(el);
    if (!value) {
      value = win.getComputedStyle(el);
      styles.set(el, value);
    }
    return value;
  };
  const small: Element[] = [];
  for (const el of parents) {
    if (el.closest(`${scriptOrGraphic}, script, style`) || parseFloat(style(el).fontSize) >= minimum - 0.01) continue;
    let script = false;
    for (let parent: Element | null = el; parent && parent !== doc.body; parent = parent.parentElement) {
      if (["super", "sub"].includes(style(parent).verticalAlign)) {
        script = true;
        break;
      }
    }
    if (!script) small.push(el);
  }
  for (const el of small) el.setAttribute("data-ra-small-text", "");
}
