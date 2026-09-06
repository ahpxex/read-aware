import type { BookMetadata, Collection, Contributor, ContributorRole, Identifier,
    LocalizedText, MediaMetadata, Rendition } from './book.js'
import { NS, camel, childGetter, getElementText, getIdentifier, parseClock } from './epub-dom.js'

const PREFIX: Readonly<Record<string, string>> = {
    a11y: 'http://www.idpf.org/epub/vocab/package/a11y/#',
    dcterms: 'http://purl.org/dc/terms/',
    marc: 'http://id.loc.gov/vocabulary/',
    media: 'http://www.idpf.org/epub/vocab/overlays/#',
    onix: 'http://www.editeur.org/ONIX/book/codelists/current.html#',
    rendition: 'http://www.idpf.org/vocab/rendition/#',
    schema: 'http://schema.org/',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    msv: 'http://www.idpf.org/epub/vocab/structure/magazine/#',
    prism: 'http://www.prismstandard.org/specifications/3.0/PRISM_CV_Spec_3.0.htm#',
}
const RELATORS: Readonly<Partial<Record<string, ContributorRole>>> = {
    art: 'artist', aut: 'author', clr: 'colorist', edt: 'editor', ill: 'illustrator',
    nrt: 'narrator', trl: 'translator', pbl: 'publisher',
}
const ONIX5: Readonly<Partial<Record<string, string>>> = {
    '02': 'isbn', '06': 'doi', '15': 'isbn', '26': 'doi', '34': 'issn',
}
type Properties = Partial<Record<string, ParsedMetadata[]>>
type ParsedMetadata = {
    property: string | null
    scheme: string | null
    lang: string | null
    value: string
    props: Properties
    attrs: Record<string, string>
}

const getPrefixes = (doc: Document) => {
    const map = new Map(Object.entries(PREFIX))
    const value = doc.documentElement.getAttributeNS(NS.EPUB, 'prefix')
        || doc.documentElement.getAttribute('prefix')
    if (value) for (const [, prefix, url] of value.matchAll(/([^\s:]+):\s+(\S+)/g))
        map.set(prefix, url)
    return map
}
const getPropertyURL = (value: string | null, prefixes: ReadonlyMap<string, string>) => {
    if (!value) return null
    const colon = value.indexOf(':')
    if (colon < 0) return null
    const base = prefixes.get(value.slice(0, colon))
    return base ? base + value.slice(colon + 1) : null
}
const one = (values?: ParsedMetadata[]) => values?.[0]?.value
const prop = (value: ParsedMetadata, name: string) => one(value.props[name])
const oneOrMany = <T>(values?: T[]): T | T[] | undefined =>
    !values?.length ? undefined : values.length === 1 ? values[0] : values

export const getMetadata = (opf: Document): {
    metadata: BookMetadata; rendition: Rendition; media: MediaMetadata
} => {
    const { $ } = childGetter(opf, NS.OPF)
    const element = $(opf.documentElement, 'metadata')
    if (!element) throw new Error('EPUB package has no metadata element')
    const children = Object.groupBy(Array.from(element.children), el =>
        el.namespaceURI === NS.DC ? 'dc'
        : el.localName === 'meta' ? el.hasAttribute('name') ? 'legacy' : 'meta' : '')
    const baseLang = element.getAttribute('xml:lang')
        ?? opf.documentElement.getAttribute('xml:lang') ?? 'und'
    const prefixes = getPrefixes(opf)
    const refines = Map.groupBy(children.meta ?? [], el => el.getAttribute('refines'))
    const getProperties = (parent?: Element, ancestors = new Set<Element>()): Properties => {
        const id = parent?.getAttribute('id')
        if (parent && !id) return {}
        const properties: Properties = {}
        for (const el of refines.get(parent ? '#' + id : null) ?? []) {
            if (ancestors.has(el)) {
                console.warn('Ignoring cyclic EPUB metadata refinement')
                continue
            }
            const parsed = parse(el, new Set(ancestors).add(el))
            if (parsed.property) (properties[parsed.property] ??= []).push(parsed)
        }
        return properties
    }
    const parse = (el: Element, ancestors = new Set<Element>()): ParsedMetadata => {
        const property = el.getAttribute('property')
        const scheme = el.getAttribute('scheme')
        return {
            property: getPropertyURL(property, prefixes) ?? property,
            scheme: getPropertyURL(scheme, prefixes) ?? scheme,
            lang: el.getAttribute('xml:lang'), value: getElementText(el),
            props: getProperties(el, ancestors),
            attrs: Object.fromEntries(Array.from(el.attributes)
                .filter(attr => attr.namespaceURI === NS.OPF)
                .map(attr => [attr.localName, attr.value])),
        }
    }
    const dc: Properties = {}
    for (const el of children.dc ?? []) (dc[el.localName] ??= []).push(parse(el))
    const properties = getProperties()
    const legacy = new Map((children.legacy ?? []).map(el =>
        [el.getAttribute('name'), el.getAttribute('content')]))

    const localized = (value?: ParsedMetadata): LocalizedText | undefined => {
        if (!value) return
        const alts = value.props['alternate-script'] ?? []
        const altRep = value.attrs['alt-rep']
        if (!alts.length && (!value.lang || value.lang === baseLang) && !altRep) return value.value
        const map = { [value.lang ?? baseLang]: value.value }
        if (altRep) map[value.attrs['alt-rep-lang'] || baseLang] = altRep
        for (const alt of alts) map[alt.lang ?? baseLang] ??= alt.value
        return map
    }
    const roles = (value: ParsedMetadata): string[] =>
        value.props.role?.filter(role => role.scheme === PREFIX.marc + 'relators')
            .map(role => role.value) ?? (value.attrs.role ? [value.attrs.role] : [])
    const contributor = (value: ParsedMetadata): Contributor => {
        const name = localized(value) ?? value.value
        const sortAs = localized(value.props['file-as']?.[0]) ?? value.attrs['file-as']
        const role = oneOrMany(roles(value))
        const code = prop(value, 'term') ?? value.attrs.term
        const scheme = prop(value, 'authority') ?? value.attrs.authority
        if (typeof name === 'string' && !sortAs && !role && !code && !scheme) return name
        return { name, ...(sortAs ? { sortAs } : {}), ...(role ? { role } : {}),
            ...(code ? { code } : {}), ...(scheme ? { scheme } : {}) }
    }
    const collection = (value: ParsedMetadata): Collection => ({
        name: localized(value) ?? value.value,
        // EPUB also permits hierarchical positions such as "2.2.1".
        position: one(value.props['group-position']),
    })
    const identifier = (item: ParsedMetadata): Identifier => {
        const { value } = item
        if (/^urn:/i.test(value)) return value
        if (/^doi:/i.test(value)) return `urn:${value}`
        const type = item.props['identifier-type']?.[0]
        if (!type) {
            const scheme = item.attrs.scheme
            if (!scheme) return value
            if (/^(doi|isbn|uuid)$/i.test(scheme)) return `urn:${scheme}:${value}`
            return { scheme, value }
        }
        const namespace = type.scheme === PREFIX.onix + 'codelist5' ? ONIX5[type.value] : undefined
        return namespace ? `urn:${namespace}:${value}` : value
    }
    const collections = Object.groupBy(properties['belongs-to-collection'] ?? [],
        item => prop(item, 'collection-type') === 'series' ? 'series' : 'collection')
    const legacySeries = legacy.get('calibre:series')
    const legacyPosition = Number.parseFloat(legacy.get('calibre:series_index') ?? '')
    const series = oneOrMany(collections.series?.map(collection))
        ?? (legacySeries ? { name: legacySeries,
            ...(Number.isFinite(legacyPosition) ? { position: legacyPosition } : {}) } : undefined)
    const mainTitle = dc.title?.find(item => prop(item, 'title-type') === 'main') ?? dc.title?.[0]
    const metadata: BookMetadata = {
        identifier: getIdentifier(opf), title: localized(mainTitle),
        sortAs: localized(mainTitle?.props['file-as']?.[0])
            ?? mainTitle?.attrs['file-as'] ?? legacy.get('calibre:title_sort') ?? undefined,
        subtitle: dc.title?.find(item => prop(item, 'title-type') === 'subtitle')?.value,
        language: oneOrMany(dc.language?.map(item => item.value)),
        description: one(dc.description), publisher: oneOrMany(dc.publisher?.map(contributor)),
        published: dc.date?.find(item => item.attrs.event === 'publication')?.value ?? one(dc.date),
        modified: one(properties[PREFIX.dcterms + 'modified'])
            ?? dc.date?.find(item => item.attrs.event === 'modification')?.value,
        subject: oneOrMany(dc.subject?.map(contributor)),
        belongsTo: series || collections.collection?.length
            ? { collection: oneOrMany(collections.collection?.map(collection)), series } : undefined,
        altIdentifier: oneOrMany(dc.identifier?.map(identifier)),
        source: oneOrMany(dc.source?.map(identifier)), rights: one(dc.rights),
        pageBreakSource: one(properties.pageBreakSource),
    }
    const contributors = new Map<ContributorRole, Contributor[]>()
    for (const [items, fallback] of [[dc.creator, 'author'], [dc.contributor, 'contributor']] as const) {
        for (const item of items ?? []) {
            const keys = new Set(roles(item).map(role => RELATORS[role] ?? fallback))
            if (!keys.size) keys.add(fallback)
            for (const key of keys) {
                const list = contributors.get(key) ?? []
                list.push(contributor(item))
                contributors.set(key, list)
            }
        }
    }
    for (const [key, values] of contributors) {
        const existing = metadata[key]
        metadata[key] = oneOrMany(existing == null ? values
            : (Array.isArray(existing) ? existing : [existing]).concat(values))
    }
    if (metadata.altIdentifier === metadata.identifier) delete metadata.altIdentifier
    const rendition: Record<string, string | undefined> = {}
    const mediaProperties: Record<string, string | undefined> = {}
    for (const [key, values] of Object.entries(properties)) {
        if (key.startsWith(PREFIX.rendition)) rendition[camel(key.slice(PREFIX.rendition.length))] = one(values)
        else if (key.startsWith(PREFIX.media)) mediaProperties[camel(key.slice(PREFIX.media.length))] = one(values)
    }
    const media: MediaMetadata = { ...mediaProperties, duration: parseClock(mediaProperties.duration) }
    return { metadata, rendition, media }
}
