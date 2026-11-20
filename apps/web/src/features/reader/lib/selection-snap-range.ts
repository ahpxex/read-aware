/**
 * Smart selection on a document: `selection-snap.ts`'s rules applied to a DOM
 * Range in a section document.
 *
 * The text the rules see is every text node from the start of the block the
 * selection starts in to the end of the block it ends in (bounded by a margin
 * on either side). Block boundaries are where the nearest block-level ancestor
 * changes, or a `<br>` breaks a line, as in verse. Ruby annotations (`<rt>`,
 * `<rp>`) are not part of the reading text; an edge inside one moves to the
 * edge of its ruby. A PDF's text layer is only trimmed and word-completed: its
 * runs are positioned glyphs, not sentences in blocks.
 */
import { indexText } from "../../../../foliate-js/src/text-index";
import { snapSelection } from "./selection-snap";

export type SelectionSnapRangeOptions = {
  /** Whether any part of `range` shows in the reader's viewport. */
  isVisible: (range: Range) => boolean;
};

/** Characters of context gathered beyond each edge of the selection. */
const CONTEXT_MARGIN = 6000;
const IGNORABLE = /[\s­​-‍⁠﻿]/u;
const NOT_READ = "rt, rp, script, style, template";
// The section document belongs to its frame's realm: compare against the DOM's numeric constants, not this window's `Node`.
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const DOCUMENT_POSITION_PRECEDING = 2;
const SHOW_ELEMENT = 0x1;
const SHOW_TEXT = 0x4;
const FILTER_ACCEPT = 1;
const FILTER_REJECT = 2;
const FILTER_SKIP = 3;

function elementOf(node: Node): Element | null {
  return node.nodeType === ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function languageOf(node: Node): string | undefined {
  for (let element = elementOf(node); element; element = element.parentElement) {
    const lang = element.getAttribute("lang") ?? element.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang");
    if (lang) return lang;
  }
  return undefined;
}

function createWalker(doc: Document, root: Node): TreeWalker {
  return doc.createTreeWalker(root, SHOW_ELEMENT | SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === TEXT_NODE) return FILTER_ACCEPT;
      const element = node as Element;
      if (element.matches(NOT_READ)) return FILTER_REJECT;
      return element.localName === "br" ? FILTER_ACCEPT : FILTER_SKIP;
    },
  });
}

/** The deepest last descendant of `node`, or `node` itself. */
function lastDescendant(node: Node): Node {
  let last = node;
  while (last.lastChild) last = last.lastChild;
  return last;
}

/** The first read text node at or after a boundary point. */
function textAtOrAfter(walker: TreeWalker, container: Node, offset: number): { node: Text; offset: number } | null {
  if (container.nodeType === TEXT_NODE && !elementOf(container)?.closest(NOT_READ))
    return { node: container as Text, offset };
  let node: Node | null = container.childNodes[offset] ?? null;
  if (!node) {
    walker.currentNode = lastDescendant(container);
    node = walker.nextNode();
  } else walker.currentNode = node;
  while (node && node.nodeType !== TEXT_NODE) node = walker.nextNode();
  return node ? { node: node as Text, offset: 0 } : null;
}

/** The last read text node at or before a boundary point. */
function textAtOrBefore(walker: TreeWalker, container: Node, offset: number): { node: Text; offset: number } | null {
  if (container.nodeType === TEXT_NODE && !elementOf(container)?.closest(NOT_READ))
    return { node: container as Text, offset };
  const before = offset > 0 ? container.childNodes[offset - 1] : null;
  let node: Node | null;
  if (before) {
    walker.currentNode = lastDescendant(before);
    node = walker.currentNode;
  } else {
    walker.currentNode = container;
    node = walker.previousNode();
  }
  while (node && (node.nodeType !== TEXT_NODE || elementOf(node)?.closest(NOT_READ))) node = walker.previousNode();
  return node ? { node: node as Text, offset: (node as Text).data.length } : null;
}

function createBlockLookup(doc: Document, root: Node) {
  const view = doc.defaultView;
  const cache = new Map<Element, boolean>();
  const isBlock = (element: Element) => {
    let block = cache.get(element);
    if (block === undefined) {
      const display = view?.getComputedStyle(element).display ?? "";
      block = !(display === "" || display === "contents" || display.startsWith("inline") || display.startsWith("ruby"));
      cache.set(element, block);
    }
    return block;
  };
  return (node: Node): Node => {
    for (let element = node.parentElement; element; element = element.parentElement) {
      if (element === root || isBlock(element)) return element;
    }
    return root;
  };
}

type Window = { nodes: Text[]; blocks: number[] };

/**
 * Text nodes from the start of `first`'s block to the end of `last`'s, at
 * most CONTEXT_MARGIN characters beyond each, with the offsets where blocks start.
 */
function collectWindow(walker: TreeWalker, blockOf: (node: Node) => Node, first: Text, last: Text): Window {
  const before: Text[] = [];
  let length = 0;
  walker.currentNode = first;
  for (let node = walker.previousNode(); node && length < CONTEXT_MARGIN; node = walker.previousNode()) {
    if (node.nodeType !== TEXT_NODE) {
      if ((node as Element).localName === "br") break;
      continue;
    }
    if (blockOf(node) !== blockOf(first)) break;
    before.unshift(node as Text);
    length += (node as Text).data.length;
  }

  const nodes = [...before];
  const blocks = [0];
  let offset = length;
  let previous: Text | null = before.at(-1) ?? null;
  let lineBreak = false;
  const append = (node: Text) => {
    if (previous && (lineBreak || blockOf(node) !== blockOf(previous)) && offset > 0) blocks.push(offset);
    nodes.push(node);
    offset += node.data.length;
    previous = node;
    lineBreak = false;
  };

  walker.currentNode = first;
  append(first);
  if (first !== last) {
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType !== TEXT_NODE) {
        if ((node as Element).localName === "br") lineBreak = true;
        continue;
      }
      append(node as Text);
      if (node === last) break;
    }
  }

  const lastBlock = blockOf(last);
  let after = 0;
  for (let node = walker.nextNode(); node && after < CONTEXT_MARGIN; node = walker.nextNode()) {
    if (node.nodeType !== TEXT_NODE) {
      if ((node as Element).localName === "br") break;
      continue;
    }
    if (blockOf(node) !== lastBlock) break;
    append(node as Text);
    after += (node as Text).data.length;
  }
  return { nodes, blocks };
}

/**
 * The selection with its edges snapped, or null when they stay where they
 * are. `range` itself is not modified.
 */
export function snapSelectionRange(range: Range, { isVisible }: SelectionSnapRangeOptions): Range | null {
  const doc = range.startContainer.ownerDocument;
  if (!doc || range.collapsed) return null;
  const textLayer = doc.querySelector(".textLayer");
  const root = textLayer ?? doc.body ?? doc.documentElement;
  if (!root?.contains(range.commonAncestorContainer)) return null;

  const working = range.cloneRange();
  const startRuby = elementOf(working.startContainer)?.closest("rt, rp")?.closest("ruby");
  if (startRuby) working.setStartBefore(startRuby);
  const endRuby = elementOf(working.endContainer)?.closest("rt, rp")?.closest("ruby");
  if (endRuby) working.setEndAfter(endRuby);

  const walker = createWalker(doc, root);
  const start = textAtOrAfter(walker, working.startContainer, working.startOffset);
  const end = textAtOrBefore(walker, working.endContainer, working.endOffset);
  if (!start || !end) return null;
  // A selection of nothing but unread content (an image, an annotation) resolves backwards.
  if (start.node !== end.node && start.node.compareDocumentPosition(end.node) & DOCUMENT_POSITION_PRECEDING)
    return null;

  const window = collectWindow(walker, createBlockLookup(doc, root), start.node, end.node);
  const index = indexText(window.nodes.map((node) => node.data));
  const nodeStart = new Map<Text, number>();
  let total = 0;
  for (const node of window.nodes) {
    nodeStart.set(node, total);
    total += node.data.length;
  }
  const from = nodeStart.get(start.node)! + start.offset;
  const to = nodeStart.get(end.node)! + end.offset;
  if (from >= to) return null;

  const toRange = (startOffset: number, endOffset: number) => {
    const mapped = index.range(startOffset, endOffset);
    const result = doc.createRange();
    result.setStart(window.nodes[mapped.startIndex]!, mapped.startOffset);
    result.setEnd(window.nodes[mapped.endIndex]!, mapped.endOffset);
    return result;
  };
  // Whether the reading text next to an edge is out of view: the drag ran to the page's edge.
  const hiddenAt = (offset: number) => !isVisible(toRange(offset, offset + 1));
  let next = to;
  while (next < index.text.length && IGNORABLE.test(index.text[next]!)) next++;
  let previous = from;
  while (previous > 0 && IGNORABLE.test(index.text[previous - 1]!)) previous--;

  const snapped = snapSelection({
    text: index.text,
    blocks: window.blocks,
    start: from,
    end: to,
    locale: languageOf(start.node),
    mode: textLayer ? "words" : "text",
    continuesAfter: next < index.text.length && hiddenAt(next),
    continuesBefore: previous > 0 && hiddenAt(previous - 1),
  });
  return snapped ? toRange(snapped.start, snapped.end) : null;
}
