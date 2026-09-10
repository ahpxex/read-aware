import { cooperativeCheckpoint } from './cooperative.js'

export type MakeTextRange = (startIndex: number, startOffset: number, endIndex: number, endOffset: number) => Range
export type TextProcessor<T> = (strings: string[], makeRange: MakeTextRange) => Iterable<T, void, unknown>
export type TextWalker = typeof textWalker

const isDocument = (node: Node): node is Document => node.nodeType === 9

const walkRange = function* (range: Range, walker: TreeWalker): Generator<Node, void, unknown> {
    for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
        const compare = range.comparePoint(node, 0)
        if (compare > 0) break
        if ((node.nodeType === 3 || node.nodeType === 4) && range.intersectsNode(node)) yield node
    }
}

const walkDocument = function* (walker: TreeWalker): Generator<Node, void, unknown> {
    for (let node = walker.nextNode(); node; node = walker.nextNode())
        yield node
}

const acceptNode = (node: Node): number => {
    if (node.nodeType === 1) {
        const name = node.nodeName.toLowerCase()
        if (name === 'script' || name === 'style') return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_SKIP
    }
    return NodeFilter.FILTER_ACCEPT
}

type TextSnapshot = { strings: string[]; makeRange: MakeTextRange }

function* collectTextSteps(x: Node | Range, filterFunc?: (node: Node) => number): Generator<undefined, TextSnapshot, unknown> {
    const isRange = 'commonAncestorContainer' in x
    const root = isRange ? x.commonAncestorContainer : isDocument(x) ? x.body ?? x : x
    const doc = root.ownerDocument ?? (isDocument(root) ? root : null)
    if (!doc) throw new Error('Text walker requires a document-owned root')
    const filter = NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_CDATA_SECTION
    const walker = doc.createTreeWalker(root, filter, { acceptNode: filterFunc || acceptNode })
    const nodes: Node[] = [], offsets: number[] = [], strings: string[] = []
    for (const node of isRange ? walkRange(x, walker) : walkDocument(walker)) {
        const offset = isRange && node === x.startContainer ? x.startOffset : 0
        nodes.push(node)
        offsets.push(offset)
        strings.push((node.nodeValue ?? '').slice(offset,
            isRange && node === x.endContainer ? x.endOffset : undefined))
        if (nodes.length % 256 === 0) yield undefined
    }
    const makeRange: MakeTextRange = (startIndex, startOffset, endIndex, endOffset) => {
        const range = doc.createRange()
        range.setStart(nodes[startIndex], offsets[startIndex] + startOffset)
        range.setEnd(nodes[endIndex], offsets[endIndex] + endOffset)
        return range
    }
    return { strings, makeRange }
}

export function* textWalker<T>(x: Node | Range, func: TextProcessor<T>, filterFunc?: (node: Node) => number): Generator<T, void, unknown> {
    const steps = collectTextSteps(x, filterFunc)
    let step = steps.next()
    while (!step.done) step = steps.next()
    yield* func(step.value.strings, step.value.makeRange)
}

export async function collectTextAsync(x: Node | Range, filterFunc?: (node: Node) => number, signal?: AbortSignal): Promise<TextSnapshot> {
    const checkpoint = cooperativeCheckpoint(signal)
    signal?.throwIfAborted()
    const steps = collectTextSteps(x, filterFunc)
    let step = steps.next()
    while (!step.done) {
        const pending = checkpoint()
        if (pending) await pending
        step = steps.next()
    }
    signal?.throwIfAborted()
    return step.value
}
