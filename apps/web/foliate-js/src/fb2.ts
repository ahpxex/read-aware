import type { Book, BookFile, BookMetadata, TOCFragment } from './book.js'

const normalizeWhitespace = (str: string | null | undefined): string => str ? str
    .replace(/[\t\n\f\r ]+/g, ' ')
    .replace(/^[\t\n\f\r ]+/, '')
    .replace(/[\t\n\f\r ]+$/, '') : ''
const getElementText = (el: Element | null | undefined): string => normalizeWhitespace(el?.textContent)

const NS = {
    XHTML: 'http://www.w3.org/1999/xhtml',
    XLINK: 'http://www.w3.org/1999/xlink',
    EPUB: 'http://www.idpf.org/2007/ops',
}

const MIME = {
    XML: 'application/xml',
    XHTML: 'application/xhtml+xml',
} as const

type Conversion = [name: string, children?: ConversionTable | 'self', attributes?: string[]]
    | 'anchor' | 'image' | 'stanza'
type ConversionTable = { [name: string]: Conversion }

const STYLE: ConversionTable = {
    'strong': ['strong', 'self'],
    'emphasis': ['em', 'self'],
    'style': ['span', 'self'],
    'a': 'anchor',
    'strikethrough': ['s', 'self'],
    'sub': ['sub', 'self'],
    'sup': ['sup', 'self'],
    'code': ['code', 'self'],
    'image': 'image',
}

const TABLE: ConversionTable = {
    'tr': ['tr', {
        'th': ['th', STYLE, ['colspan', 'rowspan', 'align', 'valign']],
        'td': ['td', STYLE, ['colspan', 'rowspan', 'align', 'valign']],
    }, ['align']],
}

const POEM: ConversionTable = {
    'epigraph': ['blockquote'],
    'subtitle': ['h2', STYLE],
    'text-author': ['p', STYLE],
    'date': ['p', STYLE],
    'stanza': 'stanza',
}

const SECTION: ConversionTable = {
    'title': ['header', {
        'p': ['h1', STYLE],
        'empty-line': ['br'],
    }],
    'epigraph': ['blockquote', 'self'],
    'image': 'image',
    'annotation': ['aside'],
    'section': ['section', 'self'],
    'p': ['p', STYLE],
    'poem': ['blockquote', POEM],
    'subtitle': ['h2', STYLE],
    'cite': ['blockquote', 'self'],
    'empty-line': ['br'],
    'table': ['table', TABLE],
    'text-author': ['p', STYLE],
}
POEM.epigraph = ['blockquote', SECTION]

const BODY: ConversionTable = {
    'image': 'image',
    'title': ['section', {
        'p': ['h1', STYLE],
        'empty-line': ['br'],
    }],
    'epigraph': ['section', SECTION],
    'section': ['section', SECTION],
}

class FB2Converter {
    readonly fb2: XMLDocument
    readonly doc: XMLDocument
    readonly bins: Map<string, Element>

    constructor(fb2: XMLDocument) {
        this.fb2 = fb2
        this.doc = document.implementation.createDocument(NS.XHTML, 'html')
        // use this instead of `getElementById` to allow images like
        // `<image l:href="#img1.jpg" id="img1.jpg" />`
        this.bins = new Map(Array.from(this.fb2.getElementsByTagName('binary'),
            el => [el.id, el]))
    }
    getImageSrc(el: Element): string {
        const href = el.getAttributeNS(NS.XLINK, 'href')
        if (!href) return 'data:,'
        const [, id] = href.split('#')
        if (!id) return href
        const bin = this.bins.get(id)
        return bin
            ? `data:${bin.getAttribute('content-type')};base64,${bin.textContent}`
            : href
    }
    image(node: Element): Element {
        const el = this.doc.createElementNS(NS.XHTML, 'img')
        for (const attr of ['alt', 'title']) {
            const value = node.getAttribute(attr)
            if (value !== null) el.setAttribute(attr, value)
        }
        el.setAttribute('src', this.getImageSrc(node))
        return el
    }
    anchor(node: Element): Element {
        const el = this.convertElement(node, { 'a': ['a', STYLE] })
        el.setAttribute('href', node.getAttributeNS(NS.XLINK, 'href') ?? '')
        if (node.getAttribute('type') === 'note')
            el.setAttributeNS(NS.EPUB, 'epub:type', 'noteref')
        return el
    }
    stanza(node: Element): Element {
        const el = this.convertElement(node, {
            'stanza': ['p', {
                'title': ['header', {
                    'p': ['strong', STYLE],
                    'empty-line': ['br'],
                }],
                'subtitle': ['p', STYLE],
            }],
        })
        for (const child of node.children) if (child.nodeName === 'v') {
            el.append(this.doc.createTextNode(child.textContent ?? ''))
            el.append(this.doc.createElement('br'))
        }
        return el
    }
    convertElement(node: Element, def: ConversionTable): Element {
        const converted = this.convert(node, def)
        if (!converted || converted.nodeType !== 1) throw new Error(`Cannot convert FB2 element: ${node.nodeName}`)
        return converted as Element
    }
    convert(node: Node, def?: ConversionTable): Node | null {
        // not an element; return text content
        if (node.nodeType === 3) return this.doc.createTextNode(node.textContent ?? '')
        if (node.nodeType === 4) return this.doc.createCDATASection(node.textContent ?? '')
        if (node.nodeType === 8) return this.doc.createComment(node.textContent ?? '')
        if (node.nodeType !== 1) return null
        const source = node as Element

        const d = def?.[node.nodeName]
        if (!d) return null
        if (typeof d === 'string') return this[d](source)

        const [name, opts, attrs] = d
        const el = this.doc.createElementNS(NS.XHTML, name)

        // copy the ID, and set class name from original element name
        if (source.id) el.id = source.id
        el.classList.add(node.nodeName)

        // copy attributes
        if (Array.isArray(attrs)) for (const attr of attrs) {
            const value = source.getAttribute(attr)
            if (value) el.setAttribute(attr, value)
        }

        // process child elements recursively
        const childDef = opts === 'self' ? def : opts
        let child = node.firstChild
        while (child) {
            const childEl = this.convert(child, childDef)
            if (childEl) el.append(childEl)
            child = child.nextSibling
        }
        return el
    }
}

const parseXML = async (blob: Pick<BookFile, 'arrayBuffer'>): Promise<XMLDocument> => {
    const buffer = await blob.arrayBuffer()
    const str = new TextDecoder('utf-8').decode(buffer)
    const parser = new DOMParser()
    const doc = parser.parseFromString(str, MIME.XML)
    const encoding = (doc as XMLDocument & { xmlEncoding?: string }).xmlEncoding
        // `Document.xmlEncoding` is deprecated, and already removed in Firefox
        // so parse the XML declaration manually
        || str.match(/^<\?xml\s+version\s*=\s*["']1.\d+"\s+encoding\s*=\s*["']([A-Za-z0-9._-]*)["']/)?.[1]
    if (encoding && encoding.toLowerCase() !== 'utf-8') {
        const str = new TextDecoder(encoding).decode(buffer)
        return parser.parseFromString(str, MIME.XML)
    }
    return doc
}

const style = URL.createObjectURL(new Blob([`
@namespace epub "http://www.idpf.org/2007/ops";
body > img, section > img {
    display: block;
    margin: auto;
}
.title h1 {
    text-align: center;
}
body > section > .title, body.notesBodyType > .title {
    margin: 3em 0;
}
body.notesBodyType > section .title h1 {
    text-align: start;
}
body.notesBodyType > section .title {
    margin: 1em 0;
}
p {
    text-indent: 1em;
    margin: 0;
}
:not(p) + p, p:first-child {
    text-indent: 0;
}
.poem p {
    text-indent: 0;
    margin: 1em 0;
}
.text-author, .date {
    text-align: end;
}
.text-author:before {
    content: "—";
}
table {
    border-collapse: collapse;
}
td, th {
    padding: .25em;
}
a[epub|type~="noteref"] {
    font-size: .75em;
    vertical-align: super;
}
body:not(.notesBodyType) > .title, body:not(.notesBodyType) > .epigraph {
    margin: 3em 0;
}
`], { type: 'text/css' }))

const template = (html: string) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
    <head><link href="${style}" rel="stylesheet" type="text/css"/></head>
    <body>${html}</body>
</html>`

// name of custom ID attribute for TOC items
const dataID = 'data-foliate-id'

export const makeFB2 = async (blob: Pick<BookFile, 'arrayBuffer'>) => {
    const doc = await parseXML(blob)
    if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'FictionBook')
        throw new Error('Invalid FictionBook document')
    const converter = new FB2Converter(doc)

    const $ = (x: string) => doc.querySelector(x)
    const $$ = (x: string) => [...doc.querySelectorAll(x)]
    const getPerson = (el: Element) => {
        const nick = getElementText(el.querySelector('nickname'))
        if (nick) return nick
        const first = getElementText(el.querySelector('first-name'))
        const middle = getElementText(el.querySelector('middle-name'))
        const last = getElementText(el.querySelector('last-name'))
        const name = [first, middle, last].filter(x => x).join(' ')
        const sortAs = last
            ? [last, [first, middle].filter(x => x).join(' ')].join(', ')
            : null
        return { name, sortAs }
    }
    const getDate = (el: Element | null) => el?.getAttribute('value') ?? getElementText(el)
    const annotation = $('title-info annotation')
    const metadata: BookMetadata = {
        title: getElementText($('title-info book-title')),
        identifier: getElementText($('document-info id')),
        language: getElementText($('title-info lang')),
        author: $$('title-info author').map(getPerson),
        translator: $$('title-info translator').map(getPerson),
        contributor: $$('document-info author').map(getPerson)
            // techincially the program probably shouldn't get the `bkp` role
            // but it has been so used by calibre, so ¯\_(ツ)_/¯
            .concat($$('document-info program-used').map(getElementText))
            .map(x => Object.assign(typeof x === 'string' ? { name: x } : x,
                { role: 'bkp' })),
        publisher: getElementText($('publish-info publisher')),
        published: getDate($('title-info date')),
        modified: getDate($('document-info date')),
        description: annotation ? converter.convertElement(annotation,
            { annotation: ['div', SECTION] }).innerHTML : null,
        subject: $$('title-info genre').map(getElementText),
    }
    const cover = $('coverpage image')
    const coverSrc = cover ? converter.getImageSrc(cover) : null
    const getCover = () => coverSrc ? fetch(coverSrc).then(res => res.blob()) : null

    // get convert each body
    type SectionElement = { el: Element; ids: string[] }
    type SectionData = SectionElement & { titles?: Array<{ title: string; index: number }>; linear?: string }
    const bodyData = Array.from(doc.querySelectorAll('body'), (body): [SectionElement[], Element] => {
        const converted = converter.convertElement(body, { body: ['body', BODY] })
        return [Array.from(converted.children, el => {
            // get list of IDs in the section
            const ids = [el, ...el.querySelectorAll('[id]')].map(el => el.id)
            return { el, ids }
        }), converted]
    })

    if (!bodyData.length) throw new Error('FictionBook document has no body')
    const urls: string[] = []
    const sectionData = bodyData[0][0]
        // make a separate section for each section in the first body
        .map(({ el, ids }): SectionData => {
            // set up titles for TOC
            const titles = Array.from(
                el.querySelectorAll(':scope > section > .title'),
                (el: Element, index) => {
                    el.setAttribute(dataID, String(index))
                    return { title: getElementText(el), index }
                })
            return { ids, titles, el }
        })
        // for additional bodies, only make one section for each body
        .concat(bodyData.slice(1).map(([sections, body]): SectionData => {
            const ids = sections.map(s => s.ids).flat()
            body.classList.add('notesBodyType')
            return { ids, el: body, linear: 'no' }
        }))
        .map(({ ids, titles, el, linear }) => {
            const str = template(el.outerHTML)
            const blob = new Blob([str], { type: MIME.XHTML })
            const url = URL.createObjectURL(blob)
            urls.push(url)
            const title = normalizeWhitespace(
                el.querySelector('.title, .subtitle, p')?.textContent
                ?? (el.classList.contains('title') ? el.textContent : ''))
            return {
                ids, title, titles, load: () => url,
                createDocument: () => new DOMParser().parseFromString(str, MIME.XHTML),
                // doo't count image data as it'd skew the size too much
                size: blob.size - Array.from(el.querySelectorAll('[src]'),
                    (el: Element) => el.getAttribute('src')?.length ?? 0)
                    .reduce((a, b) => a + b, 0),
                linear,
            }
        })

    const idMap = new Map<string, number>()
    const sections = sectionData.map((section, index) => {
        const { ids, load, createDocument, size, linear } = section
        for (const id of ids) if (id) idMap.set(id, index)
        return { id: index, load, createDocument, size, linear }
    })

    const toc = sectionData.map(({ title, titles }, index) => {
        const id = index.toString()
        return {
            label: title,
            href: id,
            subitems: titles?.length ? titles.map(({ title, index }) => ({
                label: title,
                href: `${id}#${index}`,
            })) : null,
        }
    }).filter(item => item)

    const resolveHref = (href: string) => {
        const [a, b] = href.split('#')
        const index = a ? Number(a) : idMap.get(b)
        if (index === undefined || !Number.isInteger(index) || !sections[index]) return
        return a
            // the link is from the TOC
            ? { index, anchor: (doc: Document) => doc.querySelector(`[${dataID}="${b}"]`) }
            // link from within the page
            : { index, anchor: (doc: Document) => doc.getElementById(b) }
    }
    return {
        metadata, sections, toc, getCover, resolveHref,
        splitTOCHref: (href: string): [number, number?] => {
            const [index, fragment] = href.split('#')
            return fragment === undefined ? [Number(index)] : [Number(index), Number(fragment)]
        },
        getTOCFragment: (doc: Document, id: TOCFragment | undefined) =>
            typeof id === 'number' ? doc.querySelector(`[${dataID}="${id}"]`) : null,
        isExternal: (uri: string) => /^\w+:/i.test(uri),
        destroy: () => { for (const url of urls) URL.revokeObjectURL(url) },
    } satisfies Book
}
