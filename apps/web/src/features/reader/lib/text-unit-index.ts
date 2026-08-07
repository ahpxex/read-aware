/**
 * Host-side DOM mapping for plugin-defined text-unit reader modes.
 *
 * Builds an ordered list of DOM Ranges — one per unit — for a loaded section
 * document. Segmentation runs per block element (mirroring the block walk in
 * the vendored foliate-js `tts.js`): treating the whole document as one string
 * would fuse a heading into the first unit of the following block because
 * headings often lack terminal punctuation.
 *
 * The plugin receives only one block's plain text and returns offset spans.
 * This module keeps the Foliate document and live DOM Ranges inside the host.
 */

import type {
  PluginReaderTextSegment,
  RegisteredReaderMode,
} from "../../plugins/lib/plugin-types";
import { normalizeReaderTextSegments } from "../../plugins/lib/reader-mode";

/** Opaque unit id declared by the active plugin mode. */
export type TextUnitId = string;

/** Block-level tags that reset unit segmentation (from foliate's tts.js). */
const BLOCK_TAGS = new Set([
  "article", "aside", "audio", "blockquote", "caption",
  "details", "dialog", "div", "dl", "dt", "dd",
  "figure", "footer", "form", "figcaption",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "li",
  "main", "math", "nav", "ol", "p", "pre", "section", "tr",
]);

const TEXT_FILTER = NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_CDATA_SECTION;

/**
 * Whether an element renders at all. Units must not cover text the reader
 * cannot see: the injected stylesheet hides EPUB 3 inline note bodies
 * (`<aside epub:type="footnote">`, see `reader-css.ts`), and a publisher may
 * hide anything else. A unit over hidden text would highlight nothing and
 * read the note aloud in the middle of a paragraph.
 */
function isRendered(el: Element): boolean {
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!style) return true;
  return style.display !== "none" && style.visibility !== "hidden";
}

/** Accept text/CDATA, descend through elements, skip script/style/hidden. */
function acceptTextNode(node: Node): number {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    const name = el.tagName.toLowerCase();
    if (name === "script" || name === "style") return NodeFilter.FILTER_REJECT;
    if (!isRendered(el)) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_SKIP;
  }
  return NodeFilter.FILTER_ACCEPT;
}

/** Descend through rendered elements only; hidden subtrees are not read. */
function acceptBlockNode(node: Node): number {
  return isRendered(node as Element) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
}

/** Ranges spanning from each block element's start to the next block's start. */
function* blockRanges(doc: Document): Generator<Range> {
  const body = doc.body;
  if (!body) return;
  let last: Range | null = null;
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT, {
    acceptNode: acceptBlockNode,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!BLOCK_TAGS.has((node as Element).tagName.toLowerCase())) continue;
    if (last) {
      last.setEndBefore(node);
      if (last.toString().trim()) yield last;
    }
    last = doc.createRange();
    last.setStart(node, 0);
  }
  if (!last) {
    last = doc.createRange();
    last.setStart(body.firstChild ?? body, 0);
  }
  last.setEndAfter(body.lastChild ?? body);
  if (last.toString().trim()) yield last;
}

/** The non-empty text nodes inside a block range, in document order. */
function collectTextNodes(range: Range): Node[] {
  const root = range.commonAncestorContainer;
  const walker = root.ownerDocument!.createTreeWalker(root, TEXT_FILTER, {
    acceptNode: acceptTextNode,
  });
  const nodes: Node[] = [];
  for (
    let node: Node | null = walker.currentNode;
    node;
    node = walker.nextNode()
  ) {
    if (node.nodeType === Node.ELEMENT_NODE) continue;
    const compare = range.comparePoint(node, 0);
    if (compare > 0) break;
    if (compare === 0 && (node.nodeValue?.length ?? 0) > 0) nodes.push(node);
  }
  return nodes;
}

/** Map trimmed segment offsets back onto the block's text nodes as Ranges. */
function segmentsToRanges(
  nodes: Node[],
  segments: PluginReaderTextSegment[],
): Range[] {
  // Cumulative start offset of each node's text within the joined block string.
  const starts: number[] = [];
  let total = 0;
  for (const node of nodes) {
    starts.push(total);
    total += node.nodeValue?.length ?? 0;
  }

  // Segments arrive in ascending order, so a moving pointer suffices.
  let cursor = 0;
  const locate = (pos: number): number => {
    while (cursor + 1 < nodes.length && starts[cursor + 1] <= pos) cursor++;
    return cursor;
  };

  const doc = nodes[0]?.ownerDocument;
  if (!doc) return [];
  const ranges: Range[] = [];
  for (const { start, end } of segments) {
    if (end > total) continue;
    const startNode = locate(start);
    // The end offset is exclusive, so it belongs to the node containing end-1
    // (an end that falls exactly on a node boundary maps to the previous
    // node's full length, a valid Range end).
    const endNode = locate(end - 1);
    const range = doc.createRange();
    range.setStart(nodes[startNode], start - starts[startNode]);
    range.setEnd(nodes[endNode], end - starts[endNode]);
    ranges.push(range);
  }
  return ranges;
}

/**
 * All reading units of a section document, in reading order, as live DOM
 * Ranges. The document's `lang` (set by the engine from book metadata) lets
 * the plugin pick an appropriate segmentation locale.
 */
export async function buildTextUnitRanges(
  doc: Document,
  unitId: TextUnitId,
  segmentText: RegisteredReaderMode["segmentText"],
): Promise<Range[]> {
  const units: Range[] = [];
  const language = doc.documentElement?.lang || undefined;
  // Blocks are segmented in parallel: the segmenter lives in the plugin's
  // Worker, so serializing here would pay one round trip per paragraph.
  const blocks = [...blockRanges(doc)]
    .map((block) => {
      const nodes = collectTextNodes(block);
      return { nodes, text: nodes.map((node) => node.nodeValue ?? "").join("") };
    })
    .filter((block) => block.nodes.length > 0 && Boolean(block.text.trim()));
  const segmented = await Promise.all(
    blocks.map((block) =>
      Promise.resolve(segmentText({ text: block.text, language, unitId })).catch(() => []),
    ),
  );
  for (const [index, block] of blocks.entries()) {
    const segments = normalizeReaderTextSegments(segmented[index], block.text.length);
    units.push(...segmentsToRanges(block.nodes, segments));
  }
  return units;
}

/**
 * The unit to rest on for a given visible range: the first unit still
 * (at least partly) in view — i.e. whose end lies past the viewport start.
 * Falls back to the first unit with no viewport, and to the last when the
 * viewport sits past every unit. Returns -1 only for an empty list.
 */
export function anchorTextUnitIndex(units: Range[], visible: Range | null): number {
  if (!units.length) return -1;
  if (!visible) return 0;
  for (let i = 0; i < units.length; i++) {
    try {
      if (visible.compareBoundaryPoints(Range.END_TO_START, units[i]) <= 0) return i;
    } catch {
      // Stale range from a torn-down section — anchor to the start.
      return 0;
    }
  }
  return units.length - 1;
}
