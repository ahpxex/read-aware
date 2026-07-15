/**
 * Reading-unit segmentation for the reader's sentence navigator.
 *
 * Builds an ordered list of DOM Ranges — one per unit — for a loaded section
 * document. Segmentation runs per block element (mirroring the block walk in
 * the vendored foliate-js `tts.js`): treating the whole document as one string
 * would fuse a heading into the first sentence of the paragraph after it,
 * since headings rarely end with sentence punctuation.
 *
 * Two granularities share the same block walk:
 * - `sentence` — within a block, sentences come from `Intl.Segmenter`
 *   (locale-aware, handles CJK 。！？ boundaries). Where the API is
 *   unavailable, each block falls back to a single "sentence".
 * - `paragraph` — each block is one unit, no further splitting.
 */

/** The navigator's step unit: one sentence, or one whole block element. */
export type NavigatorGranularity = "sentence" | "paragraph";

// Minimal Intl.Segmenter surface — the workspace TS lib (ES2020) predates its
// typings, but every shipping webview (WKWebView 16.4+, Chromium 87+) has it.
type SentenceSegments = Iterable<{ index: number; segment: string }>;
type SentenceSegmenter = { segment: (input: string) => SentenceSegments };
type SegmenterConstructor = new (
  locales?: string,
  options?: { granularity?: "grapheme" | "word" | "sentence" },
) => SentenceSegmenter;

function segmenterConstructor(): SegmenterConstructor | null {
  if (typeof Intl === "undefined") return null;
  return (Intl as { Segmenter?: SegmenterConstructor }).Segmenter ?? null;
}

/** Block-level tags that reset sentence segmentation (from foliate's tts.js). */
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

type Segment = { start: number; end: number };

/** Sentence boundaries within `text`, trimmed of surrounding whitespace. */
function segmentSentences(text: string, segmenter: SentenceSegmenter | null): Segment[] {
  // Book source is often pretty-printed with hard line wraps, and UAX #29
  // treats a bare line break as a mandatory sentence boundary — which would
  // shred sentences into source lines. Substitute paragraph separators with
  // spaces (same length, so every offset still maps onto the original nodes).
  const segmentable = text.replace(/[\r\n\u0085\u2028\u2029]/g, " ");
  const spans: Array<{ index: number; segment: string }> = segmenter
    ? Array.from(segmenter.segment(segmentable))
    : [{ index: 0, segment: segmentable }];
  const out: Segment[] = [];
  for (const { index, segment } of spans) {
    const leading = segment.length - segment.trimStart().length;
    const trailing = segment.length - segment.trimEnd().length;
    const start = index + leading;
    const end = index + segment.length - trailing;
    if (end > start) out.push({ start, end });
  }
  return out;
}

/** Map trimmed segment offsets back onto the block's text nodes as Ranges. */
function segmentsToRanges(nodes: Node[], segments: Segment[]): Range[] {
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
 * Ranges. The document's `lang` (set by the engine from book metadata) picks
 * the segmentation locale; `paragraph` granularity skips sentence splitting
 * entirely and yields one (trimmed) unit per block.
 */
export function buildSentenceRanges(
  doc: Document,
  granularity: NavigatorGranularity = "sentence",
): Range[] {
  let segmenter: SentenceSegmenter | null = null;
  const Segmenter = granularity === "paragraph" ? null : segmenterConstructor();
  if (Segmenter) {
    const lang = doc.documentElement?.lang || undefined;
    try {
      segmenter = new Segmenter(lang, { granularity: "sentence" });
    } catch {
      // An invalid book language tag — fall back to the default locale.
      segmenter = new Segmenter(undefined, { granularity: "sentence" });
    }
  }

  const sentences: Range[] = [];
  for (const block of blockRanges(doc)) {
    const nodes = collectTextNodes(block);
    if (!nodes.length) continue;
    const text = nodes.map((node) => node.nodeValue ?? "").join("");
    if (!text.trim()) continue;
    sentences.push(...segmentsToRanges(nodes, segmentSentences(text, segmenter)));
  }
  return sentences;
}

/**
 * The sentence to rest on for a given visible range: the first sentence still
 * (at least partly) in view — i.e. whose end lies past the viewport start.
 * Falls back to the first sentence with no viewport, and to the last when the
 * viewport sits past every sentence. Returns -1 only for an empty list.
 */
export function anchorSentenceIndex(sentences: Range[], visible: Range | null): number {
  if (!sentences.length) return -1;
  if (!visible) return 0;
  for (let i = 0; i < sentences.length; i++) {
    try {
      if (visible.compareBoundaryPoints(Range.END_TO_START, sentences[i]) <= 0) return i;
    } catch {
      // Stale range from a torn-down section — anchor to the start.
      return 0;
    }
  }
  return sentences.length - 1;
}
