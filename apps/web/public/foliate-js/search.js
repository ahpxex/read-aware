import { indexText } from './text-index.js';
// length for context in excerpts
const CONTEXT_LENGTH = 50;
const normalizeWhitespace = (str) => str.replace(/\s+/g, ' ');
const makeExcerpt = (strs, { startIndex, startOffset, endIndex, endOffset }) => {
    const start = strs[startIndex];
    const end = strs[endIndex];
    const match = startIndex === endIndex
        ? start.slice(startOffset, endOffset)
        : start.slice(startOffset)
            + strs.slice(startIndex + 1, endIndex).join('')
            + end.slice(0, endOffset);
    const trimmedStart = normalizeWhitespace(start.slice(0, startOffset)).trimStart();
    const trimmedEnd = normalizeWhitespace(end.slice(endOffset)).trimEnd();
    const ellipsisPre = trimmedStart.length < CONTEXT_LENGTH ? '' : '…';
    const ellipsisPost = trimmedEnd.length < CONTEXT_LENGTH ? '' : '…';
    const pre = `${ellipsisPre}${trimmedStart.slice(-CONTEXT_LENGTH)}`;
    const post = `${trimmedEnd.slice(0, CONTEXT_LENGTH)}${ellipsisPost}`;
    return { pre, match, post };
};
const simpleSearch = function* (strs, query, options = {}) {
    const { locales = 'en', sensitivity } = options;
    const matchCase = sensitivity === 'variant';
    const indexed = indexText(strs);
    const haystack = indexed.text;
    const lowerHaystack = matchCase ? haystack : haystack.toLocaleLowerCase(locales);
    const needle = matchCase ? query : query.toLocaleLowerCase(locales);
    const needleLength = needle.length;
    let index = -1;
    do {
        index = lowerHaystack.indexOf(needle, index + 1);
        if (index > -1) {
            const range = indexed.range(index, index + needleLength);
            yield { range, excerpt: makeExcerpt(strs, range) };
        }
    } while (index > -1);
};
function* segmentsOf(segmenter, text) {
    let whitespace;
    for (const { index, segment } of segmenter.segment(text)) {
        if (!/[^\p{Format}]/u.test(segment))
            continue;
        if (/^\s+$/u.test(segment)) {
            if (whitespace)
                whitespace.end = index + segment.length;
            else
                whitespace = { start: index, end: index + segment.length, text: ' ' };
            continue;
        }
        if (whitespace) {
            yield whitespace;
            whitespace = undefined;
        }
        yield { start: index, end: index + segment.length, text: segment };
    }
    if (whitespace)
        yield whitespace;
}
const segmenterSearch = function* (strs, query, options = {}) {
    const { locales = 'en', granularity = 'grapheme', sensitivity = 'base' } = options;
    let segmenter, collator;
    try {
        segmenter = new Intl.Segmenter(locales, { granularity });
        collator = new Intl.Collator(locales, { sensitivity });
    }
    catch (e) {
        console.warn(e);
        segmenter = new Intl.Segmenter('en', { granularity });
        collator = new Intl.Collator('en', { sensitivity });
    }
    const querySegments = [...segmentsOf(segmenter, query)];
    if (!querySegments.length)
        return;
    const normalizedQuery = querySegments.map(segment => segment.text).join('');
    const indexed = indexText(strs);
    const window = [];
    for (const segment of segmentsOf(segmenter, indexed.text)) {
        window.push(segment);
        if (window.length < querySegments.length)
            continue;
        if (collator.compare(normalizedQuery, window.map(part => part.text).join('')) === 0) {
            const range = indexed.range(window[0].start, segment.end);
            yield { range, excerpt: makeExcerpt(strs, range) };
        }
        window.shift();
    }
};
export function* search(strs, query, options = {}) {
    if (!strs.length || !query.length)
        return;
    const { granularity = 'grapheme', sensitivity = 'base' } = options;
    if (!Intl?.Segmenter || granularity === 'grapheme'
        && sensitivity === 'variant')
        yield* simpleSearch(strs, query, options);
    else
        yield* segmenterSearch(strs, query, options);
}
export const searchMatcher = (textWalker, opts) => {
    const { defaultLocale, matchCase, matchDiacritics, matchWholeWords, acceptNode } = opts;
    return function* (doc, query) {
        const iter = textWalker(doc, function* (strs, makeRange) {
            for (const result of search(strs, query, {
                locales: doc.body?.lang || doc.documentElement.lang || defaultLocale || 'en',
                granularity: matchWholeWords ? 'word' : 'grapheme',
                sensitivity: matchDiacritics && matchCase ? 'variant'
                    : matchDiacritics && !matchCase ? 'accent'
                        : !matchDiacritics && matchCase ? 'case'
                            : 'base',
            })) {
                const { startIndex, startOffset, endIndex, endOffset } = result.range;
                yield { ...result, range: makeRange(startIndex, startOffset, endIndex, endOffset) };
            }
        }, acceptNode);
        for (const result of iter)
            yield result;
    };
};
