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

import type { PluginReaderMode } from "../../plugins/lib/plugin-types";
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

/** Accept text/CDATA, descend through elements, skip script/style subtrees. */
function acceptTextNode(node: Node): number {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const name = (node as Element).tagName.toLowerCase();
    if (name === "script" || name === "style") return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_SKIP;
  }
  return NodeFilter.FILTER_ACCEPT;
}

/** Ranges spanning from each block element's start to the next block's start. */
function* blockRanges(doc: Document): Generator<Range> {
  const body = doc.body;
  if (!body) return;
  let last: Range | null = null;
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
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
  segments: ReturnType<PluginReaderMode["segmentText"]>,
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
export function buildTextUnitRanges(
  doc: Document,
  unitId: TextUnitId,
  segmentText: PluginReaderMode["segmentText"],
): Range[] {
  const units: Range[] = [];
  const language = doc.documentElement?.lang || undefined;
  for (const block of blockRanges(doc)) {
    const nodes = collectTextNodes(block);
    if (!nodes.length) continue;
    const text = nodes.map((node) => node.nodeValue ?? "").join("");
    if (!text.trim()) continue;
    const segments = normalizeReaderTextSegments(
      segmentText({ text, language, unitId }),
      text.length,
    );
    units.push(...segmentsToRanges(nodes, segments));
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
