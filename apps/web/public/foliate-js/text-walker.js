const isDocument = (node) => node.nodeType === 9;
const walkRange = (range, walker) => {
    const nodes = [];
    for (let node = walker.currentNode; node; node = walker.nextNode()) {
        const compare = range.comparePoint(node, 0);
        if (compare > 0)
            break;
        if ((node.nodeType === 3 || node.nodeType === 4) && range.intersectsNode(node))
            nodes.push(node);
    }
    return nodes;
};
const walkDocument = (walker) => {
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode())
        nodes.push(node);
    return nodes;
};
const acceptNode = (node) => {
    if (node.nodeType === 1) {
        const name = node.nodeName.toLowerCase();
        if (name === 'script' || name === 'style')
            return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
    }
    return NodeFilter.FILTER_ACCEPT;
};
export function* textWalker(x, func, filterFunc) {
    const isRange = 'commonAncestorContainer' in x;
    const root = isRange ? x.commonAncestorContainer : isDocument(x) ? x.body ?? x : x;
    const doc = root.ownerDocument ?? (isDocument(root) ? root : null);
    if (!doc)
        throw new Error('Text walker requires a document-owned root');
    const filter = NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_CDATA_SECTION;
    const walker = doc.createTreeWalker(root, filter, { acceptNode: filterFunc || acceptNode });
    const nodes = isRange ? walkRange(x, walker) : walkDocument(walker);
    const offsets = nodes.map(node => isRange && node === x.startContainer ? x.startOffset : 0);
    const strs = nodes.map((node, index) => (node.nodeValue ?? '').slice(offsets[index], isRange && node === x.endContainer ? x.endOffset : undefined));
    const makeRange = (startIndex, startOffset, endIndex, endOffset) => {
        const range = doc.createRange();
        range.setStart(nodes[startIndex], offsets[startIndex] + startOffset);
        range.setEnd(nodes[endIndex], offsets[endIndex] + endOffset);
        return range;
    };
    for (const match of func(strs, makeRange))
        yield match;
}
