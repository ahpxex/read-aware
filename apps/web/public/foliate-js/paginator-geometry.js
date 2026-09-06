const isElement = (node) => node.nodeType === 1;
// collapsed range doesn't return client rects sometimes (or always?)
// try make get a non-collapsed range or element
export const uncollapse = (range) => {
    if (!('collapsed' in range) || !range.collapsed)
        return range;
    const { endOffset, endContainer } = range;
    if (isElement(endContainer)) {
        const node = endContainer.childNodes[endOffset];
        if (node && isElement(node))
            return node;
        return endContainer;
    }
    if (endOffset + 1 < (endContainer.textContent?.length ?? 0))
        range.setEnd(endContainer, endOffset + 1);
    else if (endOffset > 1)
        range.setStart(endContainer, endOffset - 1);
    else
        return endContainer.parentElement;
    return range;
};
const makeRange = (doc, node, start, end = start) => {
    const range = doc.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return range;
};
// use binary search to find an offset value in a text node
const bisectNode = (doc, node, cb, start = 0, end = node.nodeValue?.length ?? 0) => {
    if (end <= start)
        return start;
    if (end - start === 1) {
        const result = cb(makeRange(doc, node, start), makeRange(doc, node, end));
        return result < 0 ? start : end;
    }
    const mid = Math.floor(start + (end - start) / 2);
    const result = cb(makeRange(doc, node, start, mid), makeRange(doc, node, mid, end));
    return result < 0 ? bisectNode(doc, node, cb, start, mid)
        : result > 0 ? bisectNode(doc, node, cb, mid, end) : mid;
};
const { SHOW_ELEMENT, SHOW_TEXT, SHOW_CDATA_SECTION, FILTER_ACCEPT, FILTER_REJECT, FILTER_SKIP } = NodeFilter;
const filter = SHOW_ELEMENT | SHOW_TEXT | SHOW_CDATA_SECTION;
// needed cause there seems to be a bug in `getBoundingClientRect()` in Firefox
// where it fails to include rects that have zero width and non-zero height
// (CSSOM spec says "rectangles [...] of which the height or width is not zero")
// which makes the visible range include an extra space at column boundaries
const getBoundingClientRect = (target) => {
    let top = Infinity, right = -Infinity, left = Infinity, bottom = -Infinity;
    for (const rect of target.getClientRects()) {
        left = Math.min(left, rect.left);
        top = Math.min(top, rect.top);
        right = Math.max(right, rect.right);
        bottom = Math.max(bottom, rect.bottom);
    }
    return new DOMRect(left, top, right - left, bottom - top);
};
export const getVisibleRange = (doc, start, end, mapRect) => {
    // first get all visible nodes
    const acceptNode = (node) => {
        const name = isElement(node) ? node.localName.toLowerCase() : null;
        // ignore all scripts, styles, and their children
        if (name === 'script' || name === 'style')
            return FILTER_REJECT;
        if (isElement(node)) {
            const { left, right } = mapRect(node.getBoundingClientRect());
            // no need to check child nodes if it's completely out of view
            if (right < start || left > end)
                return FILTER_REJECT;
            // elements must be completely in view to be considered visible
            // because you can't specify offsets for elements
            if (left >= start && right <= end)
                return FILTER_ACCEPT;
            // TODO: it should probably allow elements that do not contain text
            // because they can exceed the whole viewport in both directions
            // especially in scrolled mode
        }
        else {
            // ignore empty text nodes
            if (!node.nodeValue?.trim())
                return FILTER_SKIP;
            // create range to get rect
            const range = doc.createRange();
            range.selectNodeContents(node);
            const { left, right } = mapRect(range.getBoundingClientRect());
            // it's visible if any part of it is in view
            if (right >= start && left <= end)
                return FILTER_ACCEPT;
        }
        return FILTER_SKIP;
    };
    const walker = doc.createTreeWalker(doc.body, filter, { acceptNode });
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode())
        nodes.push(node);
    // we're only interested in the first and last visible nodes
    const from = nodes[0] ?? doc.body;
    const to = nodes[nodes.length - 1] ?? from;
    // find the offset at which visibility changes
    const startOffset = from.nodeType === 1 ? 0
        : bisectNode(doc, from, (a, b) => {
            const p = mapRect(getBoundingClientRect(a));
            const q = mapRect(getBoundingClientRect(b));
            if (p.right < start && q.left > start)
                return 0;
            return q.left > start ? -1 : 1;
        });
    const endOffset = to.nodeType === 1 ? 0
        : bisectNode(doc, to, (a, b) => {
            const p = mapRect(getBoundingClientRect(a));
            const q = mapRect(getBoundingClientRect(b));
            if (p.right < end && q.left > end)
                return 0;
            return q.left > end ? -1 : 1;
        });
    const range = doc.createRange();
    range.setStart(from, startOffset);
    range.setEnd(to, endOffset);
    return range;
};
export const selectionIsBackward = (sel) => {
    if (!sel.anchorNode || !sel.focusNode)
        return false;
    const range = document.createRange();
    range.setStart(sel.anchorNode, sel.anchorOffset);
    range.setEnd(sel.focusNode, sel.focusOffset);
    return range.collapsed;
};
export const setSelectionTo = (target, collapse) => {
    if (target === null || typeof target === 'number')
        return;
    let range;
    if ('startContainer' in target)
        range = target.cloneRange();
    else {
        range = target.ownerDocument.createRange();
        range.selectNode(target);
    }
    if (range) {
        const sel = range.startContainer.ownerDocument?.defaultView?.getSelection();
        if (sel) {
            sel.removeAllRanges();
            if (collapse === -1)
                range.collapse(true);
            else if (collapse === 1)
                range.collapse();
            sel.addRange(range);
        }
    }
};
export const getDirection = (doc) => {
    const { defaultView } = doc;
    if (!defaultView)
        throw new Error('Page document has no window');
    const { writingMode, direction } = defaultView.getComputedStyle(doc.body);
    const vertical = writingMode === 'vertical-rl'
        || writingMode === 'vertical-lr';
    const rtl = doc.body.dir === 'rtl'
        || direction === 'rtl'
        || doc.documentElement.dir === 'rtl';
    return { vertical, rtl };
};
export const getBackground = (doc) => {
    if (!doc.defaultView)
        throw new Error('Page document has no window');
    const bodyStyle = doc.defaultView.getComputedStyle(doc.body);
    return bodyStyle.backgroundColor === 'rgba(0, 0, 0, 0)'
        && bodyStyle.backgroundImage === 'none'
        ? doc.defaultView.getComputedStyle(doc.documentElement).background
        : bodyStyle.background;
};
export const makeMarginals = (length, part) => Array.from({ length }, () => {
    const div = document.createElement('div');
    const child = document.createElement('div');
    div.append(child);
    child.setAttribute('part', part);
    return div;
});
export const setStylesImportant = (el, styles) => {
    const { style } = el;
    for (const [k, v] of Object.entries(styles))
        style.setProperty(k, v, 'important');
};
