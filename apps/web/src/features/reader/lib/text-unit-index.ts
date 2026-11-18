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

import { AppError } from "@read-aware/core";
import type { PluginReaderTextSegment, RegisteredReaderMode } from "../../plugins/lib/plugin-types";
import { normalizeReaderTextSegments } from "../../plugins/lib/reader-mode";
import { consumePluginResult } from "../../plugins/runtime/plugin-result";
import { READER_BLOCK_TAGS } from "./reader-document-layout";

/** Opaque unit id declared by the active plugin mode. */
export type TextUnitId = string;

const SEGMENT_CONCURRENCY = 8;

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

// A superscript that is only a reference mark, not reading text (note
// numbers, asterisks, daggers, bracketed numbers). Subscripts are never
// markers ("H₂O"); a superscript with letters stays ("1st", "Mᵐᵉ").
const REFERENCE_MARK = /^[\s\d\p{No}*†‡§¶[\]()（）【】〔〕.,]+$/u;

/**
 * Inline text that sits in the reading flow but is not part of the sentence:
 * note reference markers and ruby annotations. Handed to the segmenter, a
 * note number glued to a period ("…hello.¹ Then…") defeats the sentence
 * break (UAX #29 forbids a break between a terminator and a digit), fusing
 * two sentences into one unit; ruby text interleaves the gloss with the base
 * characters. Neither is read aloud by a human reader either.
 */
function isReadingAside(el: Element): boolean {
  const name = el.localName.toLowerCase();
  if (name === "rt" || name === "rp") return true;
  const epubType = el.getAttribute("epub:type") ?? el.getAttributeNS("http://www.idpf.org/2007/ops", "type");
  if (epubType?.split(/\s+/).includes("noteref") || el.getAttribute("role") === "doc-noteref") return true;
  return name === "sup" && REFERENCE_MARK.test(el.textContent ?? "");
}

/**
 * One stretch of a block's reading text: a text node, or a forced line break,
 * which reads as whitespace but has no text node to point a Range at.
 */
type ReadingPiece = { node: Node; text: string } | { node: null; text: "\n" };

/**
 * The readable text of a section, grouped per block, in reading order.
 *
 * One pass over the document. A block element opens a new group; text joins
 * the most recently opened block in document order, so trailing text after a
 * nested block stays with that block, as a Range from each block's start to
 * the next block's start would. Hidden subtrees contribute neither text nor
 * block boundaries; script/style and inline asides (note markers, ruby
 * annotations) keep their block boundaries but contribute no text. Text
 * before the first block is read only when the body has no blocks at all.
 *
 * A `<br>` is a line break in the text. It separates words as surely as a
 * space does, and nothing else may: the text layer of a PDF page is one span
 * per typeset line with a `<br>` between them and no trailing space, so
 * without it the last word of every line fuses with the first of the next
 * and a sentence that ends a line never ends ("…problem.The impact…").
 *
 * A per-block walk from each range's common ancestor would revisit every
 * preceding sibling (and restyle each element) for every block — quadratic in
 * a chapter's paragraph count, which stalled opening a long chapter in a
 * text-unit mode on phones.
 */
function readingBlocks(doc: Document): ReadingPiece[][] {
  const body = doc.body;
  if (!body) return [];
  const blocks: ReadingPiece[][] = [];
  const leading: ReadingPiece[] = [];
  let current: ReadingPiece[] | null = null;
  const visit = (parent: Node, readable: boolean) => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
        if (readable && child.nodeValue) (current ?? leading).push({ node: child, text: child.nodeValue });
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      if (!isRendered(el)) continue;
      const name = el.tagName.toLowerCase();
      if (name === "br") {
        if (readable) (current ?? leading).push({ node: null, text: "\n" });
        continue;
      }
      if (READER_BLOCK_TAGS.has(name)) {
        current = [];
        blocks.push(current);
      }
      visit(el, readable && name !== "script" && name !== "style" && !isReadingAside(el));
    }
  };
  visit(body, true);
  return blocks.length ? blocks : [leading];
}

/**
 * Map segment offsets back onto the block's text nodes as Ranges. A boundary
 * that falls on a line break — which no Range can address — moves inward to
 * the nearest text: a unit covers the text it names, never the break beside it.
 */
function segmentsToRanges(pieces: ReadingPiece[], segments: PluginReaderTextSegment[]): Range[] {
  // Cumulative start offset of each piece's text within the joined block string.
  const starts: number[] = [];
  let total = 0;
  for (const piece of pieces) {
    starts.push(total);
    total += piece.text.length;
  }

  // Segments arrive in ascending order, so a moving pointer suffices.
  let cursor = 0;
  const locate = (pos: number): number => {
    while (cursor + 1 < pieces.length && starts[cursor + 1] <= pos) cursor++;
    return cursor;
  };

  const doc = pieces.find((piece) => piece.node)?.node?.ownerDocument;
  if (!doc) return [];
  const ranges: Range[] = [];
  for (const { start, end } of segments) {
    if (end > total) continue;
    let first = locate(start);
    let startOffset = start - starts[first];
    // The end offset is exclusive, so it belongs to the piece containing end-1
    // (an end that falls exactly on a piece boundary maps to the previous
    // piece's full length, a valid Range end).
    let last = locate(end - 1);
    let endOffset = end - starts[last];
    while (first < last && !pieces[first].node) {
      first++;
      startOffset = 0;
    }
    while (last > first && !pieces[last].node) {
      last--;
      endOffset = pieces[last].text.length;
    }
    const from = pieces[first].node;
    const to = pieces[last].node;
    // Nothing but line breaks, or boundaries that met in the same text.
    if (!from || !to || (first === last && startOffset >= endOffset)) continue;
    const range = doc.createRange();
    range.setStart(from, startOffset);
    range.setEnd(to, endOffset);
    ranges.push(range);
  }
  return ranges;
}

/**
 * The text of a unit as it reads: `Range.toString()` joins text nodes and so
 * drops every `<br>` between them, running the words on either side together.
 */
export function textUnitText(range: Range): string {
  const root = range.commonAncestorContainer;
  if (root.nodeType !== Node.ELEMENT_NODE) return range.toString();
  const fragment = range.cloneContents();
  for (const br of Array.from(fragment.querySelectorAll("br"))) br.replaceWith("\n");
  return fragment.textContent ?? "";
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
  signal?: AbortSignal,
): Promise<Range[]> {
  if (signal?.aborted) throw signal.reason;
  const results: Range[][] = [];
  const language = doc.documentElement?.lang || undefined;
  const blocks = readingBlocks(doc);
  let next = 0;
  let ordinal = 0;
  let failed = false;
  // Keep Worker round trips bounded and preserve document order even when
  // replies arrive out of order. A failure invalidates the whole section.
  const worker = async () => {
    while (!failed) {
      if (signal?.aborted) throw signal.reason;
      if (next >= blocks.length) return;
      const pieces = blocks[next++];
      const text = pieces.map((piece) => piece.text).join("");
      if (!text.trim()) continue;
      const index = ordinal++;
      try {
        await consumePluginResult(segmentText({ text, language, unitId }), (segmented) => {
          if (signal?.aborted) throw signal.reason;
          if (failed) return;
          results[index] = segmentsToRanges(pieces, normalizeReaderTextSegments(segmented, text.length));
        });
      } catch (error) {
        failed = true;
        if (signal?.aborted) throw signal.reason;
        throw new AppError("reader/segmentation-failed", "Reading mode could not segment the section", {
          cause: error,
        });
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: SEGMENT_CONCURRENCY }, worker));
    return results.flat();
  } finally {
    failed = true;
  }
}

/**
 * The unit to rest on for a given visible range: the first unit still
 * (at least partly) in view — i.e. whose end lies past the viewport start.
 * Falls back to the first unit with no viewport, and to the last when the
 * viewport sits past every unit. Returns -1 only for an empty list.
 */
/** The last unit that begins on the displayed page: where a backward step
 *  from a page the reader turned to should start. */
export function lastVisibleTextUnitIndex(units: Range[], visible: Range | null): number {
  if (!units.length) return -1;
  if (!visible) return units.length - 1;
  for (let i = units.length - 1; i >= 0; i--) {
    try {
      if (units[i].compareBoundaryPoints(Range.END_TO_START, visible) < 0) return i;
    } catch {
      return units.length - 1;
    }
  }
  return 0;
}

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
