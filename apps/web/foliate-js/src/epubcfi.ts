export type CFIStep = {
    index: number
    id?: string
    offset?: number | null
    temporal?: number
    spatial?: number[]
    text?: string[]
    side?: string
}
export type CFIPath = CFIStep[][]
export type CFIRange = { parent: CFIPath; start: CFIPath; end: CFIPath }
export type ParsedCFI = CFIPath | CFIRange
export type CFIFilter = (node: Node) => number

type Parameter = `;${string}`
type Token = ['/' | ':' | '~' | '@', number] | ['[' | Parameter, string] | ['!' | ',']

const findIndices = <T>(arr: T[], f: (value: T, index: number, arr: T[]) => boolean) => arr
    .map((x, i, a) => f(x, i, a) ? i : null).filter(x => x != null)
const splitAt = <T>(arr: T[], indices: number[]): T[][] => {
    const result: T[][] = []
    let start = 0
    for (const end of [...indices, arr.length]) {
        result.push(arr.slice(start, end))
        start = end + 1
    }
    return result
}
const concatArrays = (a: CFIPath, b: CFIPath): CFIPath =>
    a.slice(0, -1).concat([a[a.length - 1].concat(b[0])]).concat(b.slice(1))

const isNumber = /\d/
export const isCFI = /^epubcfi\((.*)\)$/
const escapeCFI = (str: string) => str.replace(/[\^[\](),;=]/g, '^$&')

const wrap = (x: string) => isCFI.test(x) ? x : `epubcfi(${x})`
const unwrap = (x: string) => x.match(isCFI)?.[1] ?? x
export const joinIndir = (...parts: string[]) => wrap(parts.map(unwrap).join('!'))
const isParameter = (value: string | null): value is Parameter => value?.startsWith(';') === true

const tokenizer = (str: string) => {
    const tokens: Token[] = []
    let state: string | null = null
    let escape = false, value = ''
    const push = (token: Token) => { tokens.push(token); state = null; value = '' }
    const cat = (char: string) => { value += char; escape = false }
    for (const char of Array.from(str.trim()).concat('')) {
        if (char === '^' && !escape) {
            escape = true
            continue
        }
        if (state === '!') push(['!'])
        else if (state === ',') push([','])
        else if (state === '/' || state === ':') {
            if (isNumber.test(char)) {
                cat(char)
                continue
            } else push([state, parseInt(value)])
        } else if (state === '~') {
            if (isNumber.test(char) || char === '.') {
                cat(char)
                continue
            } else push(['~', parseFloat(value)])
        } else if (state === '@') {
            if (char === ':') {
                push(['@', parseFloat(value)])
                state = '@'
                continue
            }
            if (isNumber.test(char) || char === '.') {
                cat(char)
                continue
            } else push(['@', parseFloat(value)])
        } else if (state === '[') {
            if (char === ';' && !escape) {
                push(['[', value])
                state = ';'
            } else if (char === ',' && !escape) {
                push(['[', value])
                state = '['
            } else if (char === ']' && !escape) push(['[', value])
            else cat(char)
            continue
        } else if (isParameter(state)) {
            if (char === '=' && !escape) {
                state = `;${value}`
                value = ''
            } else if (char === ';' && !escape) {
                push([state, value])
                state = ';'
            } else if (char === ']' && !escape) push([state, value])
            else cat(char)
            continue
        }
        if (char === '/' || char === ':' || char === '~' || char === '@'
        || char === '[' || char === '!' || char === ',') state = char
    }
    return tokens
}

const findTokens = (tokens: Token[], x: Token[0]) => findIndices(tokens, ([t]) => t === x)

const parser = (tokens: Token[]): CFIStep[] => {
    const parts: CFIStep[] = []
    let state: Token[0] | undefined
    for (const [type, val] of tokens) {
        if (type === '/') parts.push({ index: val })
        else if (type === ':' || type === '~' || type === '@' || type === ';s' || type === '[') {
            const last = parts[parts.length - 1]
            if (!last) throw new Error('Invalid CFI: assertion or offset without a step')
            if (type === ':') last.offset = val
            else if (type === '~') last.temporal = val
            else if (type === '@') last.spatial = (last.spatial ?? []).concat(val)
            else if (type === ';s') last.side = val
            else if (type === '[') {
                if (state === '/' && val) last.id = val
                else {
                    last.text = (last.text ?? []).concat(val)
                    continue
                }
            }
        }
        state = type
    }
    return parts
}

// split at step indirections, then parse each part
const parserIndir = (tokens: Token[]): CFIPath =>
    splitAt(tokens, findTokens(tokens, '!')).map(parser)

export const parse = (cfi: string): ParsedCFI => {
    const tokens = tokenizer(unwrap(cfi))
    const commas = findTokens(tokens, ',')
    if (!commas.length) return parserIndir(tokens)
    if (commas.length !== 2) throw new Error('Invalid CFI: a range needs two endpoints')
    const [parent, start, end] = splitAt(tokens, commas).map(parserIndir)
    return { parent, start, end }
}

const partToString = ({ index, id, offset, temporal, spatial, text, side }: CFIStep): string => {
    const param = side ? `;s=${side}` : ''
    return `/${index}`
        + (id ? `[${escapeCFI(id)}${param}]` : '')
        // "CFI expressions [..] SHOULD include an explicit character offset"
        + (offset != null && index % 2 ? `:${offset}` : '')
        + (temporal ? `~${temporal}` : '')
        + (spatial ? `@${spatial.join(':')}` : '')
        + (text || (!id && side) ? '['
            + (text?.map(escapeCFI)?.join(',') ?? '')
            + param + ']' : '')
}

const toInnerString = (parsed: ParsedCFI): string => Array.isArray(parsed)
    ? parsed.map(parts => parts.map(partToString).join('')).join('!')
    : [parsed.parent, parsed.start, parsed.end].map(toInnerString).join(',')

const toString = (parsed: ParsedCFI) => wrap(toInnerString(parsed))

export function collapse(x: string, toEnd?: boolean): string
export function collapse(x: ParsedCFI, toEnd?: boolean): CFIPath
export function collapse(x: string | ParsedCFI, toEnd = false): string | CFIPath {
    if (typeof x === 'string') return toString(collapse(parse(x), toEnd))
    return Array.isArray(x) ? x : concatArrays(x.parent, x[toEnd ? 'end' : 'start'])
}

// create range CFI from two CFIs
const buildRange = (from: string | ParsedCFI, to: string | ParsedCFI): string => {
    const start = collapse(typeof from === 'string' ? parse(from) : from)
    const end = collapse(typeof to === 'string' ? parse(to) : to, true)
    // ranges across multiple documents are not allowed; handle local paths only
    const localFrom = start[start.length - 1], localTo = end[end.length - 1]
    const localParent: CFIStep[] = [], localStart: CFIStep[] = [], localEnd: CFIStep[] = []
    let pushToParent = true
    const len = Math.max(localFrom.length, localTo.length)
    for (let i = 0; i < len; i++) {
        const a = localFrom[i], b = localTo[i]
        pushToParent &&= a?.index === b?.index && !a?.offset && !b?.offset
        if (pushToParent) localParent.push(a)
        else {
            if (a) localStart.push(a)
            if (b) localEnd.push(b)
        }
    }
    // copy non-local paths from `from`
    const parent = start.slice(0, -1).concat([localParent])
    return toString({ parent, start: [localStart], end: [localEnd] })
}

export const compare = (left: string | ParsedCFI, right: string | ParsedCFI): number => {
    const a = typeof left === 'string' ? parse(left) : left
    const b = typeof right === 'string' ? parse(right) : right
    if (!Array.isArray(a) || !Array.isArray(b)) return compare(collapse(a), collapse(b))
        || compare(collapse(a, true), collapse(b, true))

    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const p = a[i] ?? [], q = b[i] ?? []
        const maxIndex = Math.max(p.length, q.length) - 1
        for (let i = 0; i <= maxIndex; i++) {
            const x = p[i], y = q[i]
            if (!x) return -1
            if (!y) return 1
            if (x.index > y.index) return 1
            if (x.index < y.index) return -1
            if (i === maxIndex && x.offset != null && y.offset != null) {
                // TODO: compare temporal & spatial offsets
                if (x.offset > y.offset) return 1
                if (x.offset < y.offset) return -1
            }
        }
    }
    return 0
}

const isTextNode = (node: Node): node is Text | CDATASection => node.nodeType === 3 || node.nodeType === 4
const isElementNode = (node: Node): node is Element => node.nodeType === 1
type ContentNode = Element | Text | CDATASection
type IndexedNode = ContentNode | (Text | CDATASection)[] | null | 'first' | 'last' | 'before' | 'after'

const getChildNodes = (node: Node, filter?: CFIFilter): ContentNode[] => {
    const nodes = Array.from(node.childNodes)
        // "content other than element and character data is ignored"
        .filter(node => isTextNode(node) || isElementNode(node))
    if (!filter) return nodes
    return nodes.flatMap(node => {
        const accept = filter(node)
        if (accept === NodeFilter.FILTER_REJECT) return []
        if (accept === NodeFilter.FILTER_SKIP) return getChildNodes(node, filter)
        return [node]
    })
}

// child nodes are organized such that the result is always
//     [element, text, element, text, ..., element],
// regardless of the actual structure in the document;
// so multiple text nodes need to be combined, and nonexistent ones counted;
// see "Step Reference to Child Element or Character Data (/)" in EPUB CFI spec
const indexChildNodes = (node: Node, filter?: CFIFilter): IndexedNode[] => {
    const nodes = getChildNodes(node, filter)
        .reduce<IndexedNode[]>((arr, node) => {
            const last = arr[arr.length - 1]
            if (!last) arr.push(node)
            // "there is one chunk between each pair of child elements"
            else if (isTextNode(node)) {
                if (Array.isArray(last)) last.push(node)
                else if (typeof last !== 'string' && isTextNode(last)) arr[arr.length - 1] = [last, node]
                else arr.push(node)
            } else {
                if (!Array.isArray(last) && typeof last !== 'string' && isElementNode(last)) arr.push(null, node)
                else arr.push(node)
            }
            return arr
        }, [])
    // "the first chunk is located before the first child element"
    const first = nodes[0], last = nodes[nodes.length - 1]
    if (first && typeof first !== 'string' && !Array.isArray(first) && isElementNode(first))
        nodes.unshift('first')
    // "the last chunk is located after the last child element"
    if (last && typeof last !== 'string' && !Array.isArray(last) && isElementNode(last))
        nodes.push('last')
    // "'virtual' elements"
    nodes.unshift('before') // "0 is a valid index"
    nodes.push('after') // "n+2 is a valid index"
    return nodes
}

type Boundary = { node: Node; offset: number; before?: boolean; after?: boolean }

const partsToNode = (root: Element, parts: CFIStep[], filter?: CFIFilter): Boundary => {
    const last = parts[parts.length - 1]
    if (!last) throw new Error('Invalid CFI: empty path')
    if (last.id) {
        const el = root.ownerDocument.getElementById(last.id)
        if (el) return { node: el, offset: 0 }
    }
    let node: Node | (Text | CDATASection)[] | null = root
    for (const { index } of parts) {
        if (!node || Array.isArray(node)) throw new Error('Invalid CFI: path does not resolve')
        const newNode: IndexedNode = indexChildNodes(node, filter)[index]
        // handle non-existent nodes
        if (newNode === 'first') return { node: node.firstChild ?? node, offset: 0 }
        if (newNode === 'last') return { node: node.lastChild ?? node, offset: 0 }
        if (newNode === 'before') return { node, offset: 0, before: true }
        if (newNode === 'after') return { node, offset: 0, after: true }
        node = newNode
    }
    if (!node) throw new Error('Invalid CFI: path does not resolve')
    const offset = last.offset ?? 0
    if (!Array.isArray(node)) return { node, offset }
    // get underlying text node and offset from the chunk
    let sum = 0
    for (const n of node) {
        const { length } = n
        if (sum + length >= offset) return { node: n, offset: offset - sum }
        sum += length
    }
    throw new Error('Invalid CFI: character offset exceeds text length')
}

const nodeToParts = (node: Node, offset: number | null = null, filter?: CFIFilter): CFIStep[] => {
    const doc = node.ownerDocument
    const id = isElementNode(node) ? node.id : undefined
    let parentNode = node.parentNode
    if (!doc || !parentNode) throw new Error('Cannot create a CFI for a detached node')
    while (filter && parentNode.parentNode
        && parentNode !== doc.documentElement
        && filter(parentNode) === NodeFilter.FILTER_SKIP)
        parentNode = parentNode.parentNode
    const indexed = indexChildNodes(parentNode, filter)
    const index = indexed.findIndex(x =>
        Array.isArray(x) ? x.some(x => x === node) : x === node)
    // adjust offset as if merging the text nodes in the chunk
    const chunk = indexed[index]
    if (Array.isArray(chunk)) {
        let sum = 0
        for (const x of chunk) {
            if (x === node) {
                sum += offset ?? 0
                break
            } else sum += x.length
        }
        offset = sum
    }
    const part = { id, index, offset }
    return (parentNode !== doc.documentElement
        ? nodeToParts(parentNode, null, filter).concat(part) : [part])
        // remove ignored nodes
        .filter(x => x.index !== -1)
}

export const fromRange = (range: Range, filter?: CFIFilter): string => {
    const { startContainer, startOffset, endContainer, endOffset } = range
    const start = nodeToParts(startContainer, startOffset, filter)
    if (range.collapsed) return toString([start])
    const end = nodeToParts(endContainer, endOffset, filter)
    return buildRange([start], [end])
}

export const toRange = (doc: Document, parts: ParsedCFI, filter?: CFIFilter): Range => {
    const startParts = collapse(parts)
    const endParts = collapse(parts, true)

    const root = doc.documentElement
    const start = partsToNode(root, startParts[0], filter)
    const end = partsToNode(root, endParts[0], filter)

    const range = doc.createRange()

    if (start.before) range.setStartBefore(start.node)
    else if (start.after) range.setStartAfter(start.node)
    else range.setStart(start.node, start.offset)

    if (end.before) range.setEndBefore(end.node)
    else if (end.after) range.setEndAfter(end.node)
    else range.setEnd(end.node, end.offset)
    return range
}

// faster way of getting CFIs for sorted elements in a single parent
export const fromElements = (elements: Element[]): string[] => {
    if (!elements.length) return []
    const results: string[] = []
    const { parentNode } = elements[0]
    if (!parentNode) throw new Error('Cannot create a CFI for detached elements')
    const parts = nodeToParts(parentNode)
    for (const [index, node] of indexChildNodes(parentNode).entries()) {
        const el = elements[results.length]
        if (node === el)
            results.push(toString([parts.concat({ id: el.id, index })]))
    }
    return results
}

export const toElement = (doc: Document, parts: CFIStep[]): Element | null => {
    const { node } = partsToNode(doc.documentElement, parts)
    return isElementNode(node) ? node : null
}

// turn indices into standard CFIs when you don't have an actual package document
export const fake = {
    fromIndex: (index: number): string => wrap(`/6/${(index + 1) * 2}`),
    toIndex: (parts: CFIStep[] | undefined): number => (parts?.at(-1)?.index ?? NaN) / 2 - 1,
}

// get CFI from Calibre bookmarks
// see https://github.com/johnfactotum/foliate/issues/849
export const fromCalibrePos = (pos: string): string => {
    const parsed = parse(pos)
    if (!Array.isArray(parsed)) throw new Error('Invalid Calibre position: expected a point CFI')
    const [parts] = parsed
    const item = parts.shift()
    if (!item) throw new Error('Invalid Calibre position: missing spine item')
    parts.shift()
    return toString([[{ index: 6 }, item], parts])
}
export const fromCalibreHighlight = ({ spine_index, start_cfi, end_cfi }: {
    spine_index: number; start_cfi: string; end_cfi: string
}): string => {
    const pre = fake.fromIndex(spine_index) + '!'
    return buildRange(pre + start_cfi.slice(2), pre + end_cfi.slice(2))
}
