export const NS = {
    CONTAINER: 'urn:oasis:names:tc:opendocument:xmlns:container',
    XHTML: 'http://www.w3.org/1999/xhtml',
    OPF: 'http://www.idpf.org/2007/opf',
    EPUB: 'http://www.idpf.org/2007/ops',
    DC: 'http://purl.org/dc/elements/1.1/',
    DCTERMS: 'http://purl.org/dc/terms/',
    ENC: 'http://www.w3.org/2001/04/xmlenc#',
    NCX: 'http://www.daisy.org/z3986/2005/ncx/',
    XLINK: 'http://www.w3.org/1999/xlink',
    SMIL: 'http://www.w3.org/ns/SMIL',
} as const

export const MIME = {
    XML: 'application/xml',
    NCX: 'application/x-dtbncx+xml',
    XHTML: 'application/xhtml+xml',
    HTML: 'text/html',
    CSS: 'text/css',
    SVG: 'image/svg+xml',
    JS: /\/(x-)?(javascript|ecmascript)/,
} as const

export const camel = (value: string) => value.toLowerCase()
    .replace(/[-:](.)/g, (_: string, char: string) => char.toUpperCase())

export const getElementText = (element?: Element | null) => (element?.textContent ?? '')
    .replace(/[\t\n\f\r ]+/g, ' ').replace(/^ | $/g, '')

export const childGetter = (doc: Document, ns: string) => {
    // Some older publications omit namespaces altogether.
    const useNS = doc.lookupNamespaceURI(null) === ns || !!doc.lookupPrefix(ns)
    const matches = (element: Element, name: string) =>
        element.localName === name && (!useNS || element.namespaceURI === ns)
    return {
        $: (parent: Element | Document | null | undefined, name: string) =>
            Array.from(parent?.children ?? []).find(element => matches(element, name)),
        $$: (parent: Element | Document | null | undefined, name: string) =>
            Array.from(parent?.children ?? []).filter(element => matches(element, name)),
        $$$: (parent: Element | Document, name: string) => Array.from(useNS
            ? parent.getElementsByTagNameNS(ns, name) : parent.getElementsByTagName(name)),
    }
}

export const resolveURL = (url: string, relativeTo: string): string => {
    try {
        if (relativeTo.includes(':')) return new URL(url, relativeTo).href
        const root = 'https://invalid.invalid/'
        const result = new URL(url, root + relativeTo)
        result.search = ''
        return decodeURI(result.href.replace(root, ''))
    } catch (error) {
        console.warn('Could not resolve EPUB resource URL', error)
        return url
    }
}

export const isExternal = (uri: string) => /^(?!blob:)\w+:/i.test(uri)

export const getIdentifier = (opf: Document) => getElementText(
    opf.getElementById(opf.documentElement.getAttribute('unique-identifier') ?? '')
    ?? opf.getElementsByTagNameNS(NS.DC, 'identifier')[0])

export const parseClock = (value?: string | null): number | undefined => {
    if (!value) return
    const clock = value.trim()
    const parts = clock.split(':').map(Number)
    if (parts.length === 2 || parts.length === 3) {
        if (parts.some(part => !Number.isFinite(part) || part < 0)) return
        return parts.reduce((seconds, part) => seconds * 60 + part, 0)
    }
    const match = /^(\d+(?:\.\d*)?|\.\d+)\s*(h|min|ms|s)?$/.exec(clock)
    if (!match) return
    const multiplier = match[2] === 'h' ? 3600 : match[2] === 'min' ? 60
        : match[2] === 'ms' ? .001 : 1
    return Number(match[1]) * multiplier
}
