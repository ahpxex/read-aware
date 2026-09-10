import type { Book, ResolvedNavigation } from './book.js'
import * as CFI from './epubcfi.js'
import { contentCFI, type TextQuote } from './content-navigation.js'
import { textWalker } from './text-walker.js'

export class ContentRangeError extends Error {
    constructor(readonly reason: 'not-found' | 'unsupported' | 'ambiguous' | 'invalid-offset') {
        super('Content range: ' + reason)
        this.name = 'ContentRangeError'
    }
}

/** The same CFI resolver used by View, without creating a renderer or history. */
export function resolveContentCFI(book: Book, cfi: string): ResolvedNavigation {
    if (book.resolveCFI) return book.resolveCFI(cfi)
    const parts = CFI.parse(cfi)
    const parent = Array.isArray(parts) ? parts : parts.parent
    const base = parent.shift()
    if (!base) throw new ContentRangeError('not-found')
    const index = CFI.fake.toIndex(base)
    // A page/spine CFI has no local document path. PDF quote navigation resolves
    // its text anchor only after the renderer has loaded the page's text layer.
    if (Array.isArray(parts) && !parts.length) return { index }
    return { index, anchor: doc => CFI.toRange(doc, parts) }
}

const compact = (text: string) => text.replace(/[\s\u00ad]/gu, '')
function quoteOffsets(text: string, quote: TextQuote): [number, number] {
    const positions: number[] = []
    let normalized = ''
    for (let i = 0; i < text.length; i++) if (compact(text[i])) { positions.push(i); normalized += text[i] }
    const exact = compact(quote.exact), before = compact(quote.prefix ?? ''), after = compact(quote.suffix ?? '')
    if (!exact) throw new ContentRangeError('not-found')
    let found: [number, number] | undefined
    for (let start = normalized.indexOf(exact); start !== -1; start = normalized.indexOf(exact, start + 1)) {
        const end = start + exact.length
        if (before && normalized.slice(Math.max(0, start - before.length), start) !== before
            || after && normalized.slice(end, end + after.length) !== after) continue
        if (found) throw new ContentRangeError('ambiguous')
        found = [positions[start], positions[end - 1] + 1]
    }
    if (!found) throw new ContentRangeError('not-found')
    return found
}

function readText(range: Range): string {
    return [...textWalker(range, strings => [strings.join('')])][0] ?? ''
}
const splitsPair = (text: string, offset: number) => offset > 0 && offset < text.length
    && /[\uD800-\uDBFF]/u.test(text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(text[offset])

/** Resolve once, validate the allowed section before loading any passage text. */
export async function readContentRange(book: Book, input: { cfi: string; textQuote?: TextQuote },
    options: { offset: number; limit: number; contextChars: number },
    allow: (index: number) => void, signal?: AbortSignal): Promise<{
        cfi: string; textQuote?: TextQuote; sectionIndex: number; text: string; totalLength: number;
        nextOffset: number | null; context: { before: string; after: string }
    }> {
    signal?.throwIfAborted()
    let resolved: ResolvedNavigation
    try {
        const parsed = CFI.parse(input.cfi)
        // Range reads accept engine-issued canonical CFIs, not the permissive
        // navigation parser's recovery of malformed text or nested documents.
        if (CFI.toString(parsed) !== input.cfi
            || (!Array.isArray(parsed) && (parsed.parent.length !== 2 || parsed.start.length !== 1 || parsed.end.length !== 1))
            || (Array.isArray(parsed) && parsed.length !== 1)) throw new ContentRangeError('not-found')
        resolved = resolveContentCFI(book, input.cfi)
    }
    catch { throw new ContentRangeError('not-found') }
    const section = book.sections[resolved.index]
    if (!Number.isInteger(resolved.index) || !section) throw new ContentRangeError('not-found')
    allow(resolved.index)
    let text: string, before: string, after: string, cfi = input.cfi, textQuote = input.textQuote
    if (section.createDocument) {
        const doc = await section.createDocument()
        signal?.throwIfAborted()
        let range: Range
        try {
            const anchor = typeof resolved.anchor === 'function' ? resolved.anchor(doc) : resolved.anchor
            if (!anchor || typeof anchor === 'number' || !('commonAncestorContainer' in anchor)) throw new ContentRangeError('not-found')
            range = anchor
            if (range.collapsed) throw new ContentRangeError('not-found')
            const root = doc.body ?? doc.documentElement
            if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) throw new ContentRangeError('not-found')
            for (const node of [range.startContainer, range.endContainer]) {
                const element = node.nodeType === 1 ? node as Element : node.parentElement
                if (element?.closest('script,style')) throw new ContentRangeError('not-found')
            }
            cfi = contentCFI(book, resolved.index, range)
            text = readText(range)
            const preceding = doc.createRange(); preceding.selectNodeContents(root); preceding.setEnd(range.startContainer, range.startOffset)
            const following = doc.createRange(); following.selectNodeContents(root); following.setStart(range.endContainer, range.endOffset)
            before = readText(preceding); after = readText(following)
            // A precise CFI already disambiguates repeated text. A quote verifies it,
            // but cannot relocate a stale/mismatching CFI to another occurrence.
            if (textQuote && (compact(text) !== compact(textQuote.exact)
                || !compact(before).endsWith(compact(textQuote.prefix ?? ''))
                || !compact(after).startsWith(compact(textQuote.suffix ?? '')))) throw new ContentRangeError('not-found')
        } catch (error) {
            if (error instanceof ContentRangeError) throw error
            throw new ContentRangeError('not-found')
        }
    } else if (section.getText) {
        if (!textQuote || input.cfi !== contentCFI(book, resolved.index)) throw new ContentRangeError('not-found')
        const source = await section.getText()
        signal?.throwIfAborted()
        const [start, end] = quoteOffsets(source, textQuote)
        text = source.slice(start, end); before = source.slice(0, start); after = source.slice(end)
    } else throw new ContentRangeError('unsupported')
    signal?.throwIfAborted()
    if (!text.trim()) throw new ContentRangeError('not-found')
    if (options.offset > text.length || splitsPair(text, options.offset)) throw new ContentRangeError('invalid-offset')
    let end = Math.min(text.length, options.offset + options.limit)
    if (splitsPair(text, end)) end--
    let startContext = Math.max(0, before.length - options.contextChars), endContext = Math.min(after.length, options.contextChars)
    if (splitsPair(before, startContext)) startContext++
    if (splitsPair(after, endContext)) endContext--
    return { cfi, ...(textQuote ? { textQuote } : {}), sectionIndex: resolved.index, text: text.slice(options.offset, end),
        totalLength: text.length, nextOffset: end < text.length ? end : null,
        context: { before: before.slice(startContext), after: after.slice(0, endContext) } }
}
