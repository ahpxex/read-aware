const NS = {
    ATOM: 'http://www.w3.org/2005/Atom',
    OPDS: 'http://opds-spec.org/2010/catalog',
    THR: 'http://purl.org/syndication/thread/1.0',
    DC: 'http://purl.org/dc/elements/1.1/',
    DCTERMS: 'http://purl.org/dc/terms/',
}

const MIME = {
    ATOM: 'application/atom+xml',
    OPDS2: 'application/opds+json',
}

export const REL = {
    ACQ: 'http://opds-spec.org/acquisition',
    FACET: 'http://opds-spec.org/facet',
    GROUP: 'http://opds-spec.org/group',
    COVER: [
        'http://opds-spec.org/image',
        'http://opds-spec.org/cover', // ManyBooks legacy, not in spec
        'x-stanza-cover-image', // Lexcycle Stanza legacy
    ],
    THUMBNAIL: [
        'http://opds-spec.org/image/thumbnail',
        'http://opds-spec.org/thumbnail', // ManyBooks legacy, not in spec
        'x-stanza-cover-image-thumbnail', // Lexcycle Stanza legacy
    ],
}

const SUMMARY = Symbol('summary')
const CONTENT = Symbol('content')
export const SYMBOL = { SUMMARY, CONTENT } as const

const FACET_GROUP = Symbol('facetGroup')

export type OPDSContent = { type: string; value: string }
export type OPDSLink = {
    rel?: string[]
    href: string | null
    type: string | null
    title: string | null
    properties: {
        price: { currency: string | null; value: string | null } | null
        indirectAcquisition: Array<{ type: string | null }>
        numberOfItems: string | null
    }
    [FACET_GROUP]: string | null
}
export type OPDSNavigation = Partial<OPDSLink> & { [SUMMARY]?: string | null }
export type OPDSPublication = ReturnType<typeof getPublication>
export type SearchParameters = ReadonlyMap<string | null, ReadonlyMap<string, string>>

const groupByArray = <T, K extends PropertyKey | null | undefined>(arr: T[] | null | undefined, f: (value: T) => K | K[]): Map<K, T[]> => {
    const map = new Map<K, T[]>()
    if (arr) for (const el of arr) {
        const keys = f(el)
        for (const key of Array.isArray(keys) ? keys : [keys]) {
            const group = map.get(key)
            if (group) group.push(el)
            else map.set(key, [el])
        }
    }
    return map
}

// https://www.rfc-editor.org/rfc/rfc7231#section-3.1.1
const parseMediaType = (str: string | null | undefined) => {
    if (!str) return null
    const [mediaType, ...ps] = str.split(/ *; */)
    return {
        mediaType: mediaType.toLowerCase(),
        parameters: Object.fromEntries(ps.map(p => {
            const [name, val] = p.split('=')
            return [name.toLowerCase(), val?.replace(/(^"|"$)/g, '')]
        })),
    }
}

export const isOPDSCatalog = (str: string | null | undefined): boolean => {
    const parsed = parseMediaType(str)
    if (!parsed) return false
    const { mediaType, parameters } = parsed
    if (mediaType === MIME.OPDS2) return true
    return mediaType === MIME.ATOM && parameters.profile?.toLowerCase() === 'opds-catalog'
}

// ignore the namespace if it doesn't appear in document at all
const useNS = (doc: Document, ns: string) =>
    doc.lookupNamespaceURI(null) === ns || doc.lookupPrefix(ns) ? ns : null

const filterNS = (ns: string | null) => ns
    ? (name: string) => (el: Element) => el.namespaceURI === ns && el.localName === name
    : (name: string) => (el: Element) => el.localName === name

const getContent = (el: Element | undefined): OPDSContent | undefined => {
    if (!el) return
    const type = el.getAttribute('type') ?? 'text'
    const value = type === 'xhtml' ? el.innerHTML
        : type === 'html' ? (el.textContent ?? '')
            .replaceAll('&lt;', '<')
            .replaceAll('&gt;', '>')
            .replaceAll('&amp;', '&')
        : el.textContent ?? ''
    return { value, type }
}

const getTextContent = (el: Element | undefined) => {
    const content = getContent(el)
    if (content?.type === 'text') return content?.value
}

const getSummary = (a: Element | undefined, b: Element | undefined) => getTextContent(a) ?? getTextContent(b)

const getPrice = (link: Element) => {
    const price = link.getElementsByTagNameNS(NS.OPDS, 'price')[0]
    return price ? {
        currency: price.getAttribute('currencycode'),
        value: price.textContent,
    } : null
}

const getIndirectAcquisition = (el: Element): Array<{ type: string | null }> => {
    const ia = el.getElementsByTagNameNS(NS.OPDS, 'indirectAcquisition')[0]
    if (!ia) return []
    return [{ type: ia.getAttribute('type') }, ...getIndirectAcquisition(ia)]
}

const getLink = (link: Element): OPDSLink => {
    const obj: OPDSLink = {
        rel: link.getAttribute('rel')?.split(/ +/),
        href: link.getAttribute('href'),
        type: link.getAttribute('type'),
        title: link.getAttribute('title'),
        properties: {
            price: getPrice(link),
            indirectAcquisition: getIndirectAcquisition(link),
            numberOfItems: link.getAttributeNS(NS.THR, 'count'),
        },
        [FACET_GROUP]: link.getAttributeNS(NS.OPDS, 'facetGroup'),
    }
    if (link.getAttributeNS(NS.OPDS, 'activeFacet') === 'true')
        obj.rel = [obj.rel ?? []].flat().concat('self')
    return obj
}

const getPerson = (person: Element) => {
    const NS = person.namespaceURI
    const uri = person.getElementsByTagNameNS(NS, 'uri')[0]?.textContent
    return {
        name: person.getElementsByTagNameNS(NS, 'name')[0]?.textContent ?? '',
        links: uri ? [{ href: uri }] : [],
    }
}

export const getPublication = (entry: Element) => {
    const filter = filterNS(useNS(entry.ownerDocument, NS.ATOM))
    const children = Array.from(entry.children)
    const filterDCEL = filterNS(NS.DC)
    const filterDCTERMS = filterNS(NS.DCTERMS)
    const filterDC = (x: string) => {
        const a = filterDCEL(x), b = filterDCTERMS(x)
        return (y: Element) => a(y) || b(y)
    }
    const links = children.filter(filter('link')).map(getLink)
    const linksByRel = groupByArray(links, link => link.rel)
    return {
        metadata: {
            title: children.find(filter('title'))?.textContent ?? '',
            author: children.filter(filter('author')).map(getPerson),
            contributor: children.filter(filter('contributor')).map(getPerson),
            publisher: children.find(filterDC('publisher'))?.textContent,
            published: (children.find(filterDCTERMS('issued'))
                ?? children.find(filterDC('date')))?.textContent,
            language: children.find(filterDC('language'))?.textContent,
            identifier: children.find(filterDC('identifier'))?.textContent,
            subject: children.filter(filter('category')).map(category => ({
                name: category.getAttribute('label'),
                code: category.getAttribute('term'),
                scheme: category.getAttribute('scheme'),
            })),
            rights: children.find(filter('rights'))?.textContent ?? '',
            [SYMBOL.CONTENT]: getContent(children.find(filter('content'))
                ?? children.find(filter('summary'))),
        },
        links,
        images: REL.COVER.concat(REL.THUMBNAIL)
            .map(R => linksByRel.get(R)?.[0]).filter((link): link is OPDSLink => link !== undefined),
    }
}

export const getFeed = (doc: Document) => {
    const ns = useNS(doc, NS.ATOM)
    const filter = filterNS(ns)
    const children = Array.from(doc.documentElement.children)
    const entries = children.filter(filter('entry'))
    const links = children.filter(filter('link')).map(getLink)
    const linksByRel = groupByArray(links, link => link.rel)

    const groupedItems = new Map<string | null, Array<OPDSPublication | OPDSNavigation>>([[null, []]])
    const groupLinkMap = new Map<string | null, OPDSLink>()
    for (const entry of entries) {
        const children = Array.from(entry.children)
        const links = children.filter(filter('link')).map(getLink)
        const linksByRel = groupByArray(links, link => link.rel)
        const isPub = [...linksByRel.keys()]
            .some(rel => rel?.startsWith(REL.ACQ) || rel === 'preview')

        const groupLinks = linksByRel.get(REL.GROUP) ?? linksByRel.get('collection')
        const groupLink = groupLinks?.length
            ? groupLinks.find(link => groupedItems.has(link.href)) ?? groupLinks[0] : null
        if (groupLink && !groupLinkMap.has(groupLink.href))
            groupLinkMap.set(groupLink.href, groupLink)

        const item: OPDSPublication | OPDSNavigation = isPub
            ? getPublication(entry)
            : Object.assign(links.find(link => isOPDSCatalog(link.type)) ?? links[0] ?? {}, {
                title: children.find(filter('title'))?.textContent,
                [SYMBOL.SUMMARY]: getSummary(children.find(filter('summary')),
                    children.find(filter('content'))),
            })

        const key = groupLink?.href ?? null
        const arr = groupedItems.get(key)
        if (arr) arr.push(item)
        else groupedItems.set(key, [item])
    }
    const [items, ...groups] = Array.from(groupedItems, ([key, items]) => {
        const publications = items.filter((item): item is OPDSPublication => 'metadata' in item)
        const navigation = items.filter((item): item is OPDSNavigation => !('metadata' in item))
        const content = {
            ...(publications.length ? { publications } : {}),
            ...(navigation.length || !publications.length ? { navigation } : {}),
        }
        if (key == null) return content
        const link = groupLinkMap.get(key)
        if (!link) return content
        return {
            metadata: {
                title: link.title,
                numberOfItems: link.properties.numberOfItems,
            },
            links: [{ rel: 'self', href: link.href, type: link.type }],
            ...content,
        }
    })
    return {
        metadata: {
            title: children.find(filter('title'))?.textContent,
            subtitle: children.find(filter('subtitle'))?.textContent,
        },
        links,
        ...items,
        groups,
        facets: Array.from(
            groupByArray(linksByRel.get(REL.FACET) ?? [], link => link[FACET_GROUP]),
            ([facet, links]) => ({ metadata: { title: facet }, links })),
    }
}

export const getSearch = async (link: { href: string; title?: string | null }) => {
    const { replace, getVariables } = await import('./uri-template.js')
    return {
        metadata: {
            title: link.title,
        },
        search: (map: SearchParameters) => replace(link.href, map.get(null) ?? new Map()),
        params: Array.from(getVariables(link.href), name => ({ name })),
    }
}

export const getOpenSearch = (doc: Document) => {
    const defaultNS = doc.documentElement.namespaceURI
    const filter = filterNS(defaultNS)
    const children = Array.from(doc.documentElement.children)

    const $$urls = children.filter(filter('Url'))
    const $url = $$urls.find(url => isOPDSCatalog(url.getAttribute('type'))) ?? $$urls[0]
    if (!$url) throw new Error('document must contain at least one Url element')

    const regex = /{(?:([^}]+?):)?(.+?)(\?)?}/g
    const defaultMap = new Map([
        ['count', '100'],
        ['startIndex', $url.getAttribute('indexOffset') ?? '0'],
        ['startPage', $url.getAttribute('pageOffset') ?? '0'],
        ['language', '*'],
        ['inputEncoding', 'UTF-8'],
        ['outputEncoding', 'UTF-8'],
    ])

    const template = $url.getAttribute('template')
    if (!template) throw new Error('OpenSearch Url must contain a template')
    return {
        metadata: {
            title: (children.find(filter('LongName')) ?? children.find(filter('ShortName')))?.textContent,
            description: children.find(filter('Description'))?.textContent,
        },
        search: (map: SearchParameters) => template.replace(regex, (_: string, prefix: string | undefined, param: string) => {
            const namespace = prefix ? $url.lookupNamespaceURI(prefix) : null
            const ns = namespace === defaultNS ? null : namespace
            const val = map.get(ns)?.get(param)
            return encodeURIComponent(val ? val : (!ns ? defaultMap.get(param) ?? '' : ''))
        }),
        params: Array.from(template.matchAll(regex), ([, prefix, param, optional]) => {
            const namespace = prefix ? $url.lookupNamespaceURI(prefix) : null
            const ns = namespace === defaultNS ? null : namespace
            return {
                ns, name: param,
                required: !optional,
                value: ns && ns !== defaultNS ? '' : defaultMap.get(param) ?? '',
            }
        }),
    }
}
