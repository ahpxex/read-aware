import { textWalker } from './text-walker.js';
export async function* searchBook(book, query, index, options, getCFI, signal) {
    const { searchMatcher } = await import('./search.js');
    const matcher = searchMatcher(textWalker, options);
    const indices = index == null ? Array.from(book.sections.keys()) : [index];
    for (const i of indices) {
        if (signal.aborted)
            return;
        const section = book.sections[i];
        if (!section)
            throw new RangeError(`Invalid search section: ${i}`);
        if (section.createDocument) {
            const doc = await section.createDocument();
            if (signal.aborted)
                return;
            const subitems = [];
            for (const { range, excerpt } of matcher(doc, query)) {
                if (signal.aborted)
                    return;
                const hit = { cfi: getCFI(i, range), excerpt };
                if (index != null)
                    yield hit;
                else
                    subitems.push(hit);
            }
            if (index == null && subitems.length)
                yield { index: i, subitems };
        }
        if (index == null)
            yield { progress: (i + 1) / book.sections.length };
    }
}
