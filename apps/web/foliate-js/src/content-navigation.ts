import {
  checkContentDocument,
  checkContentText,
  ContentBudgetError,
  CONTENT_QUERY_MAX_SOURCE_BYTES,
} from "./content-budget.js";
import type { Book } from "./book.js";
import * as CFI from "./epubcfi.js";
import { searchAsync, matcherSearchOptions, type SearchExcerpt, type SearchMatcherOptions } from "./search.js";
import { collectTextAsync, textWalker } from "./text-walker.js";

export type TextQuote = { exact: string; prefix?: string; suffix?: string };
export type ContentMatch = {
  cfi: string;
  excerpt: SearchExcerpt;
  textQuote?: TextQuote;
  /** See shortBlockText: the whole text of the short block the match is in. */
  blockText?: string;
};
export type ContentSearchItem = ContentMatch | { textLength: number };

export function contentCFI(book: Book, index: number, range?: Range): string {
  const section = book.sections[index];
  if (!section) throw new RangeError("Invalid content section");
  const base = section.cfi ?? CFI.fake.fromIndex(index);
  return range ? CFI.joinIndir(base, CFI.fromRange(range)) : base;
}

/** The elements whose text is one line of the book, innermost first. */
const LINE_BLOCKS = "h1, h2, h3, h4, h5, h6, p, li, dt, dd, blockquote, figcaption, caption, td, th, div";
/** Room for any heading, contents line or caption; a longer block is running
 *  text, which a match's excerpt already describes. Bounds what a hit carries. */
const SHORT_BLOCK_MAX_LENGTH = 200;

/**
 * Reads the whole text of the block a match is in, when that block is short:
 * a heading, a line of a contents page, a caption, a line of dialogue. An
 * excerpt cannot say this: it holds the matched text node only, so the same
 * words read alike as a chapter's title and inside a paragraph. Each block is
 * read once per document, however many matches it holds.
 */
function shortBlockReader(): (range: Range) => string | undefined {
  const texts = new Map<Element, string | undefined>();
  return (range) => {
    const start = range.startContainer;
    const block = (start.nodeType === 1 ? (start as Element) : start.parentElement)?.closest(LINE_BLOCKS);
    // A match running on into the next block belongs to neither line.
    if (!block?.contains(range.endContainer)) return undefined;
    if (!texts.has(block)) {
      const text = (block.textContent ?? "").replace(/\s+/g, " ").trim();
      texts.set(block, text.length <= SHORT_BLOCK_MAX_LENGTH ? text : undefined);
    }
    return texts.get(block);
  };
}

/** Search without touching View.search's highlight registry or another caller. */
export async function* searchContentSection(
  book: Book,
  index: number,
  query: string,
  options: SearchMatcherOptions,
  signal?: AbortSignal,
): AsyncGenerator<ContentSearchItem, void, unknown> {
  signal?.throwIfAborted();
  const section = book.sections[index];
  if (!section) throw new RangeError("Invalid content section");
  if (section.createDocument) {
    if (section.size > CONTENT_QUERY_MAX_SOURCE_BYTES) throw new ContentBudgetError();
    const doc = await section.createDocument();
    signal?.throwIfAborted();
    checkContentDocument(doc);
    const { strings, makeRange } = await collectTextAsync(doc, options.acceptNode, signal);
    yield { textLength: strings.join("").trim().length };
    const shortBlockText = shortBlockReader();
    for await (const { range, excerpt } of searchAsync(strings, query, matcherSearchOptions(doc, options), signal)) {
      signal?.throwIfAborted();
      const { startIndex, startOffset, endIndex, endOffset } = range;
      const match = makeRange(startIndex, startOffset, endIndex, endOffset);
      const blockText = shortBlockText(match);
      yield { cfi: contentCFI(book, index, match), excerpt, ...(blockText ? { blockText } : {}) };
    }
  } else if (section.getText) {
    const text = checkContentText(await section.getText(signal));
    signal?.throwIfAborted();
    yield { textLength: text.trim().length };
    for await (const { range, excerpt } of searchAsync(
      [text],
      query,
      {
        granularity: options.matchWholeWords ? "word" : "grapheme",
        sensitivity: options.matchCase ? "variant" : "accent",
      },
      signal,
    )) {
      signal?.throwIfAborted();
      yield {
        cfi: contentCFI(book, index),
        excerpt,
        textQuote: {
          exact: text.slice(range.startOffset, range.endOffset),
          prefix: text.slice(Math.max(0, range.startOffset - 80), range.startOffset),
          suffix: text.slice(range.endOffset, range.endOffset + 80),
        },
      };
    }
  }
}

const compact = (text: string) => text.replace(/[\s\u00ad]/gu, "");

/** PDF extraction and DOM text layers differ in whitespace, not text identity. */
export function resolveTextQuote(doc: Document, quote: TextQuote): Range {
  const matches = [
    ...textWalker(doc.querySelector(".textLayer") ?? doc, function* (strings, makeRange) {
      const positions: Array<{ node: number; offset: number }> = [];
      let text = "";
      for (const [node, value] of strings.entries()) {
        for (let offset = 0; offset < value.length; offset++) {
          if (!compact(value[offset])) continue;
          text += value[offset];
          positions.push({ node, offset });
        }
      }
      const needle = compact(quote.exact),
        prefix = compact(quote.prefix ?? ""),
        suffix = compact(quote.suffix ?? "");
      if (!needle) return;
      let count = 0;
      for (let start = text.indexOf(needle); start !== -1; start = text.indexOf(needle, start + 1)) {
        const end = start + needle.length;
        if (
          (prefix && text.slice(Math.max(0, start - prefix.length), start) !== prefix) ||
          (suffix && text.slice(end, end + suffix.length) !== suffix)
        )
          continue;
        const first = positions[start],
          last = positions[end - 1];
        yield makeRange(first.node, first.offset, last.node, last.offset + 1);
        // Two matches already establish ambiguity; do not materialize every range.
        if (++count === 2) return;
      }
    }),
  ];
  if (matches.length !== 1)
    throw new Error(matches.length ? "Text quote is ambiguous" : "Text quote no longer resolves");
  return matches[0];
}
