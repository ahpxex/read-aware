import type { Book } from './book.js'
import * as CFI from './epubcfi.js'
import { search, searchMatcher, type SearchExcerpt, type SearchMatcherOptions } from './search.js'
import { textWalker } from './text-walker.js'

export type TextQuote = { exact: string; prefix?: string; suffix?: string }
export type ContentMatch = { cfi: string; excerpt: SearchExcerpt; textQuote?: TextQuote }
export type ContentSearchItem = ContentMatch | { textLength: number }

export function contentCFI(book: Book, index: number, range?: Range): string {
    const section = book.sections[index]
    if (!section) throw new RangeError('Invalid content section')
    const base = section.cfi ?? CFI.fake.fromIndex(index)
    return range ? CFI.joinIndir(base, CFI.fromRange(range)) : base
}

/** Search without touching View.search's highlight registry or another caller. */
export async function* searchContentSection(book: Book, index: number, query: string,
    options: SearchMatcherOptions, signal?: AbortSignal): AsyncGenerator<ContentSearchItem, void, unknown> {
    signal?.throwIfAborted()
    const section = book.sections[index]
    if (!section) throw new RangeError('Invalid content section')
    if (section.createDocument) {
        const doc = await section.createDocument()
        signal?.throwIfAborted()
        yield { textLength: [...textWalker(doc, strings => [strings.join('').trim().length])][0] ?? 0 }
        for (const { range, excerpt } of searchMatcher(textWalker, options)(doc, query)) {
            signal?.throwIfAborted()
            yield { cfi: contentCFI(book, index, range), excerpt }
        }
    } else if (section.getText) {
        const text = await section.getText()
        signal?.throwIfAborted()
        yield { textLength: text.trim().length }
        for (const { range, excerpt } of search([text], query, {
            granularity: options.matchWholeWords ? 'word' : 'grapheme',
            sensitivity: options.matchCase ? 'variant' : 'accent',
        })) {
            signal?.throwIfAborted()
            yield { cfi: contentCFI(book, index), excerpt, textQuote: {
                exact: text.slice(range.startOffset, range.endOffset),
                prefix: text.slice(Math.max(0, range.startOffset - 80), range.startOffset),
                suffix: text.slice(range.endOffset, range.endOffset + 80),
            } }
        }
    }
}

const compact = (text: string) => text.replace(/[\s\u00ad]/gu, '')

/** PDF extraction and DOM text layers differ in whitespace, not text identity. */
export function resolveTextQuote(doc: Document, quote: TextQuote): Range {
    const matches = [...textWalker(doc.querySelector('.textLayer') ?? doc, function* (strings, makeRange) {
        const positions: Array<{ node: number; offset: number }> = []
        let text = ''
        for (const [node, value] of strings.entries()) {
            for (let offset = 0; offset < value.length; offset++) {
                if (!compact(value[offset])) continue
                text += value[offset]
                positions.push({ node, offset })
            }
        }
        const needle = compact(quote.exact), prefix = compact(quote.prefix ?? ''), suffix = compact(quote.suffix ?? '')
        if (!needle) return
        let count = 0
        for (let start = text.indexOf(needle); start !== -1; start = text.indexOf(needle, start + 1)) {
            const end = start + needle.length
            if (prefix && text.slice(Math.max(0, start - prefix.length), start) !== prefix
                || suffix && text.slice(end, end + suffix.length) !== suffix) continue
            const first = positions[start], last = positions[end - 1]
            yield makeRange(first.node, first.offset, last.node, last.offset + 1)
            // Two matches already establish ambiguity; do not materialize every range.
            if (++count === 2) return
        }
    })]
    if (matches.length !== 1) throw new Error(matches.length ? 'Text quote is ambiguous' : 'Text quote no longer resolves')
    return matches[0]
}
