import {
  checkContentDocument,
  checkContentText,
  ContentBudgetError,
  CONTENT_QUERY_MAX_SOURCE_BYTES,
} from "./content-budget.js";
import type { Book, ResolvedNavigation } from "./book.js";
import * as CFI from "./epubcfi.js";
import { contentCFI, type TextQuote } from "./content-navigation.js";
import { textWalker } from "./text-walker.js";

export class ContentRangeError extends Error {
  constructor(readonly reason: "not-found" | "unsupported" | "ambiguous" | "invalid-offset") {
    super("Content range: " + reason);
    this.name = "ContentRangeError";
  }
}

/** The same CFI resolver used by View, without creating a renderer or history. */
export function resolveContentCFI(book: Book, cfi: string): ResolvedNavigation {
  if (book.resolveCFI) return book.resolveCFI(cfi);
  const parts = CFI.parse(cfi);
  const parent = Array.isArray(parts) ? parts : parts.parent;
  const base = parent.shift();
  if (!base) throw new ContentRangeError("not-found");
  let index = CFI.fake.toIndex(base);
  const token = base.at(-1)?.id;
  const virtual = book.sections.some((section) => section.cfi?.includes("[rav1-"));
  if (virtual) {
    // Never apply an ordinal-only legacy CFI to a newly published virtual
    // source. Only a stable section id AND identical wrapped document prove
    // that the old local DOM path still describes the same text.
    if (!token || !/^rav1-[a-f0-9]{64}-[a-f0-9]{64}$/.test(token)) throw new ContentRangeError("not-found");
    const matches = book.sections.flatMap((section, i) => (section.cfi?.endsWith(`[${token}])`) ? [i] : []));
    if (matches.length !== 1) throw new ContentRangeError("not-found");
    index = matches[0];
  }
  // A page/spine CFI has no local document path. PDF quote navigation resolves
  // its text anchor only after the renderer has loaded the page's text layer.
  if (Array.isArray(parts) && !parts.length) return { index };
  return { index, anchor: (doc) => CFI.toRange(doc, parts) };
}

const compact = (text: string) => text.replace(/[\s\u00ad]/gu, "");
function quoteOffsets(text: string, quote: TextQuote): [number, number] {
  const positions: number[] = [];
  let normalized = "";
  for (let i = 0; i < text.length; i++)
    if (compact(text[i])) {
      positions.push(i);
      normalized += text[i];
    }
  const exact = compact(quote.exact),
    before = compact(quote.prefix ?? ""),
    after = compact(quote.suffix ?? "");
  if (!exact) throw new ContentRangeError("not-found");
  let found: [number, number] | undefined;
  for (let start = normalized.indexOf(exact); start !== -1; start = normalized.indexOf(exact, start + 1)) {
    const end = start + exact.length;
    if (
      (before && normalized.slice(Math.max(0, start - before.length), start) !== before) ||
      (after && normalized.slice(end, end + after.length) !== after)
    )
      continue;
    if (found) throw new ContentRangeError("ambiguous");
    found = [positions[start], positions[end - 1] + 1];
  }
  if (!found) throw new ContentRangeError("not-found");
  return found;
}

function readText(range: Range): string {
  return [...textWalker(range, (strings) => [strings.join("")])][0] ?? "";
}

/** Capture the loaded source identity, not PDF text-layer implementation paths. */
export function captureContentRange(book: Book, index: number, range: Range): { cfi: string; textQuote?: TextQuote } {
  const section = book.sections[index];
  if (!section || range.collapsed) throw new ContentRangeError("not-found");
  if (section.createDocument) return { cfi: contentCFI(book, index, range) };
  if (!section.getText) throw new ContentRangeError("unsupported");
  const doc = range.startContainer.ownerDocument;
  const root = doc?.querySelector(".textLayer");
  if (!doc || !root?.contains(range.startContainer) || !root.contains(range.endContainer))
    throw new ContentRangeError("not-found");
  const before = doc.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const after = doc.createRange();
  after.selectNodeContents(root);
  after.setStart(range.endContainer, range.endOffset);
  return {
    cfi: contentCFI(book, index),
    textQuote: {
      exact: readText(range),
      prefix: readText(before).slice(-80),
      suffix: readText(after).slice(0, 80),
    },
  };
}
/**
 * Where a CFI lies in its section, as offsets into the text that extraction
 * reads of it: `body.textContent` for a document, the page text for a text
 * section. It returns positions only, never passage text, and accepts every
 * CFI the reader issues (a viewport is rarely a canonical range).
 *
 * A CFI without a range is a point (start === end). A text section's CFI names
 * the whole page; a quote narrows it when it resolves once there.
 */
export async function locateContentRange(
  book: Book,
  input: { cfi: string; textQuote?: TextQuote },
  signal?: AbortSignal,
): Promise<{ sectionIndex: number; start: number; end: number }> {
  signal?.throwIfAborted();
  let resolved: ResolvedNavigation;
  try {
    resolved = resolveContentCFI(book, input.cfi);
  } catch {
    throw new ContentRangeError("not-found");
  }
  const section = book.sections[resolved.index];
  if (!Number.isInteger(resolved.index) || !section) throw new ContentRangeError("not-found");
  if (section.createDocument) {
    const doc = await section.createDocument();
    signal?.throwIfAborted();
    const body = doc.body;
    if (!body) throw new ContentRangeError("unsupported");
    let anchor: Range | Element | number | null | undefined;
    try {
      anchor = typeof resolved.anchor === "function" ? resolved.anchor(doc) : resolved.anchor;
    } catch {
      throw new ContentRangeError("not-found");
    }
    // No local path: the section itself, from its first character.
    if (anchor == null || typeof anchor === "number") return { sectionIndex: resolved.index, start: 0, end: 0 };
    const range = doc.createRange();
    if ("startContainer" in anchor) {
      range.setStart(anchor.startContainer, anchor.startOffset);
      range.setEnd(anchor.endContainer, anchor.endOffset);
    } else range.selectNodeContents(anchor);
    if (!body.contains(range.startContainer) || !body.contains(range.endContainer))
      throw new ContentRangeError("not-found");
    // The same measure extraction uses for chapter anchors, so both agree on every offset.
    const before = doc.createRange();
    before.selectNodeContents(body);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    return { sectionIndex: resolved.index, start, end: start + range.toString().length };
  }
  if (section.getText) {
    const source = await section.getText(signal);
    signal?.throwIfAborted();
    if (input.textQuote) {
      try {
        const [start, end] = quoteOffsets(source, input.textQuote);
        return { sectionIndex: resolved.index, start, end };
      } catch (error) {
        // An absent or repeated quote still leaves the page it was captured on.
        if (!(error instanceof ContentRangeError)) throw error;
      }
    }
    return { sectionIndex: resolved.index, start: 0, end: source.length };
  }
  throw new ContentRangeError("unsupported");
}

const splitsPair = (text: string, offset: number) =>
  offset > 0 &&
  offset < text.length &&
  /[\uD800-\uDBFF]/u.test(text[offset - 1]) &&
  /[\uDC00-\uDFFF]/u.test(text[offset]);

/** Resolve once, validate the allowed section before loading any passage text. */
export async function readContentRange(
  book: Book,
  input: { cfi: string; textQuote?: TextQuote },
  options: { offset: number; limit: number; contextChars: number },
  allow: (index: number) => void,
  signal?: AbortSignal,
): Promise<{
  cfi: string;
  textQuote?: TextQuote;
  sectionIndex: number;
  text: string;
  totalLength: number;
  nextOffset: number | null;
  context: { before: string; after: string };
}> {
  signal?.throwIfAborted();
  let resolved: ResolvedNavigation;
  try {
    const parsed = CFI.parse(input.cfi);
    // Range reads accept engine-issued canonical CFIs, not the permissive
    // navigation parser's recovery of malformed text or nested documents.
    if (
      CFI.toString(parsed) !== input.cfi ||
      (!Array.isArray(parsed) &&
        (parsed.parent.length !== 2 || parsed.start.length !== 1 || parsed.end.length !== 1)) ||
      (Array.isArray(parsed) && parsed.length !== 1)
    )
      throw new ContentRangeError("not-found");
    resolved = resolveContentCFI(book, input.cfi);
  } catch {
    throw new ContentRangeError("not-found");
  }
  const section = book.sections[resolved.index];
  if (!Number.isInteger(resolved.index) || !section) throw new ContentRangeError("not-found");
  allow(resolved.index);
  let text: string,
    before: string,
    after: string,
    cfi = input.cfi,
    textQuote = input.textQuote;
  if (section.createDocument) {
    if (section.size > CONTENT_QUERY_MAX_SOURCE_BYTES) throw new ContentBudgetError();
    const doc = await section.createDocument();
    signal?.throwIfAborted();
    checkContentDocument(doc);
    let range: Range;
    try {
      const anchor = typeof resolved.anchor === "function" ? resolved.anchor(doc) : resolved.anchor;
      if (!anchor || typeof anchor === "number" || !("commonAncestorContainer" in anchor))
        throw new ContentRangeError("not-found");
      range = anchor;
      if (range.collapsed) throw new ContentRangeError("not-found");
      const root = doc.body ?? doc.documentElement;
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer))
        throw new ContentRangeError("not-found");
      for (const node of [range.startContainer, range.endContainer]) {
        const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
        if (element?.closest("script,style")) throw new ContentRangeError("not-found");
      }
      cfi = contentCFI(book, resolved.index, range);
      text = readText(range);
      const preceding = doc.createRange();
      preceding.selectNodeContents(root);
      preceding.setEnd(range.startContainer, range.startOffset);
      const following = doc.createRange();
      following.selectNodeContents(root);
      following.setStart(range.endContainer, range.endOffset);
      before = readText(preceding);
      after = readText(following);
      // A precise CFI already disambiguates repeated text. A quote verifies it,
      // but cannot relocate a stale/mismatching CFI to another occurrence.
      if (
        textQuote &&
        (compact(text) !== compact(textQuote.exact) ||
          !compact(before).endsWith(compact(textQuote.prefix ?? "")) ||
          !compact(after).startsWith(compact(textQuote.suffix ?? "")))
      )
        throw new ContentRangeError("not-found");
    } catch (error) {
      if (error instanceof ContentRangeError) throw error;
      throw new ContentRangeError("not-found");
    }
  } else if (section.getText) {
    if (!textQuote || input.cfi !== contentCFI(book, resolved.index)) throw new ContentRangeError("not-found");
    const source = checkContentText(await section.getText(signal));
    signal?.throwIfAborted();
    const [start, end] = quoteOffsets(source, textQuote);
    text = source.slice(start, end);
    before = source.slice(0, start);
    after = source.slice(end);
  } else throw new ContentRangeError("unsupported");
  signal?.throwIfAborted();
  if (!text.trim()) throw new ContentRangeError("not-found");
  if (options.offset > text.length || splitsPair(text, options.offset)) throw new ContentRangeError("invalid-offset");
  let end = Math.min(text.length, options.offset + options.limit);
  if (splitsPair(text, end)) end--;
  let startContext = Math.max(0, before.length - options.contextChars),
    endContext = Math.min(after.length, options.contextChars);
  if (splitsPair(before, startContext)) startContext++;
  if (splitsPair(after, endContext)) endContext--;
  return {
    cfi,
    ...(textQuote ? { textQuote } : {}),
    sectionIndex: resolved.index,
    text: text.slice(options.offset, end),
    totalLength: text.length,
    nextOffset: end < text.length ? end : null,
    context: { before: before.slice(startContext), after: after.slice(0, endContext) },
  };
}
