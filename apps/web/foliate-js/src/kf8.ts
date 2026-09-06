import type { Book, BookMetadata, BookSection, Rendition, TOCFragment, TOCItem, ResourceTransformDetail } from './book.js'
import type { MOBI } from './mobi.js'
import { MIME, unescapeHTML } from './mobi-html.js'
import { FDST_HEADER, getStruct, getUint, getIndexData, concatTypedArray, concatTypedArray3 } from './mobi-binary.js'
import type { NCXItem, IndexEntry } from './mobi-binary.js'

// handlers for `kindle:` uris
const kindleResourceRegex = /kindle:(flow|embed):(\w+)(?:\?mime=(\w+\/[-+.\w]+))?/
const kindlePosRegex = /kindle:pos:fid:(\w+):off:(\w+)/
const parseResourceURI = (str: string) => {
    const match = str.match(kindleResourceRegex)
    if (!match) throw new Error('Invalid Kindle resource URI')
    const [, resourceType, id, type] = match
    if (!/^[0-9a-v]+$/i.test(id)) throw new Error('Invalid Kindle resource index')
    return { resourceType, id: parseInt(id, 32), type: type ?? '' }
}
// READAWARE: a non-`kindle:pos:` href (a synthesized or foreign TOC entry)
// yields null instead of throwing from inside an async resolver.
const parsePosURI = (str: string) => {
    const match = typeof str === 'string' ? str.match(kindlePosRegex) : null
    if (!match) return null
    const [fid, off] = match.slice(1)
    if (!/^[0-9a-v]+$/i.test(fid) || !/^[0-9a-v]+$/i.test(off)) return null
    return { fid: parseInt(fid, 32), off: parseInt(off, 32) }
}
const makePosURI = (fid = 0, off = 0) =>
    `kindle:pos:fid:${fid.toString(32).toUpperCase().padStart(4, '0')
    }:off:${off.toString(32).toUpperCase().padStart(10, '0')}`

// `kindle:pos:` links are originally links that contain fragments identifiers
// so there should exist an element with `id` or `name`
// otherwise try to find one with an `aid` attribute
const getFragmentSelector = (str: string) => {
    const match = str.match(/\s(id|name|aid)\s*=\s*['"]([^'"]*)['"]/i)
    if (!match) return
    const [, attr, value] = match
    return `[${attr}="${CSS.escape(value)}"]`
}

const getPageSpread = (properties: string[]) => {
    for (const p of properties) {
        if (p === 'page-spread-left' || p === 'rendition:page-spread-left')
            return 'left'
        if (p === 'page-spread-right' || p === 'rendition:page-spread-right')
            return 'right'
        if (p === 'rendition:page-spread-center') return 'center'
    }
}

type Skeleton = { index: number; name: string; numFrag: number; offset: number; length: number }
type Fragment = { insertOffset: number; selector?: string; index: number; offset: number; length: number }
type KF8Section = { skel: Skeleton; frags: Fragment[]; fragEnd: number; length: number; totalLength: number }
const tagValue = (tags: IndexEntry['tagMap'], tag: number, index = 0): number => {
    const value = tags[tag]?.[index]
    if (value == null) throw new Error(`Missing KF8 index tag ${tag}:${index}`)
    return value
}

export class KF8 implements Book {
    sections: BookSection[] = []
    toc: TOCItem[] | undefined
    landmarks: TOCItem[] | undefined
    dir: string | undefined
    rendition: Rendition = {}
    metadata: BookMetadata = {}

    parser = new DOMParser()
    serializer = new XMLSerializer()
    transformTarget = new EventTarget()
    #resourceCache = new Map<string, Promise<string>>()
    #sectionCache = new Map<KF8Section, Promise<string>>()
    #fragmentOffsets = new Map<number, number[]>()
    #fragmentSelectors = new Map<number, Map<number, string | undefined>>()
    #flows: Array<[number, number]> | undefined
    #sections: KF8Section[] = []
    #fullRawLength: number | undefined
    #rawHead = new Uint8Array()
    #rawTail = new Uint8Array()
    #lastLoadedHead = -1
    #lastLoadedTail = -1
    #type: DOMParserSupportedType = MIME.XHTML
    #inlineMap = new Map<string, Element>()
    #urls = new Set<string>()
    #closed = false
    #rawQueue = Promise.resolve()
    constructor(readonly mobi: MOBI) {}
    get #header() {
        const header = this.mobi.headers.kf8
        if (!header) throw new Error('Missing KF8 header')
        return header
    }
    async init() {
        const loadRecord = this.mobi.loadRecord.bind(this.mobi)
        const kf8 = this.#header

        try {
            const fdstBuffer = await loadRecord(kf8.fdst)
            const fdst = getStruct(FDST_HEADER, fdstBuffer)
            if (fdst.magic !== 'FDST') throw new Error('Missing FDST record')
            const fdstTable = Array.from({ length: fdst.numEntries },
                (_, i) => 12 + i * 8)
                .map((offset): [number, number] => [
                    getUint(fdstBuffer.slice(offset, offset + 4)),
                    getUint(fdstBuffer.slice(offset + 4, offset + 8))])
            this.#flows = fdstTable
            this.#fullRawLength = fdstTable.at(-1)?.[1]
        } catch (error) { console.warn('KF8 flow index unavailable; reading text from the beginning', error) }

        const skelTable = (await getIndexData(kf8.skel, loadRecord)).table
            .map(({ name, tagMap }, index) => ({
                index, name,
                numFrag: tagValue(tagMap, 1),
                offset: tagValue(tagMap, 6),
                length: tagValue(tagMap, 6, 1),
            }))
        const fragData = await getIndexData(kf8.frag, loadRecord)
        const fragTable = fragData.table.map(({ name, tagMap }) => ({
            insertOffset: parseInt(name),
            selector: fragData.cncx[tagValue(tagMap, 2)],
            index: tagValue(tagMap, 4),
            offset: tagValue(tagMap, 6),
            length: tagValue(tagMap, 6, 1),
        }))

        this.#sections = skelTable.reduce<KF8Section[]>((arr, skel) => {
            const last = arr[arr.length - 1]
            const fragStart = last?.fragEnd ?? 0, fragEnd = fragStart + skel.numFrag
            const frags = fragTable.slice(fragStart, fragEnd)
            const length = skel.length + frags.map(f => f.length).reduce((a, b) => a + b, 0)
            const totalLength = (last?.totalLength ?? 0) + length
            return arr.concat({ skel, frags, fragEnd, length, totalLength })
        }, [])

        const resources = await this.getResourcesByMagic(['RESC', 'PAGE'])
        const pageSpreads = new Map<number, string | undefined>()
        if (resources.RESC != null) {
            const buf = await this.mobi.loadRecord(resources.RESC)
            const str = this.mobi.decode(buf.slice(16)).replace(/\0/g, '')
            // the RESC record lacks the root `<package>` element
            // but seem to be otherwise valid XML
            const xmlStr = `<package>${str.replace(/^\s*<\?xml[^?]*\?>/, '')}</package>`
            const opf = this.parser.parseFromString(xmlStr, MIME.XML)
            for (const $itemref of opf.querySelectorAll('spine > itemref')) {
                const i = parseInt($itemref.getAttribute('skelid') ?? '')
                if (!Number.isInteger(i)) continue
                pageSpreads.set(i, getPageSpread(
                    $itemref.getAttribute('properties')?.split(' ') ?? []))
            }
        }

        this.sections = this.#sections.map((section, index) => ({
                id: index,
                load: () => this.loadSection(section),
                createDocument: () => this.createDocument(section),
                size: section.length,
                pageSpread: pageSpreads.get(index),
                ...(section.frags.length ? {} : { linear: 'no' }),
            }))

        try {
            const ncx = await this.mobi.getNCX()
            const map = ({ label, pos, children }: NCXItem): TOCItem => {
                const fid = pos?.[0], off = pos?.[1] ?? 0
                const href = fid == null ? null : makePosURI(fid, off)
                if (fid != null) {
                    const arr = this.#fragmentOffsets.get(fid)
                    if (arr) arr.push(off)
                    else this.#fragmentOffsets.set(fid, [off])
                }
                return { label: unescapeHTML(label), href, subitems: children?.map(map) }
            }
            this.toc = ncx?.map(map)
            this.landmarks = await this.getGuide()
        } catch(e) {
            console.warn(e)
        }

        const { exth } = this.mobi.headers
        this.dir = exth?.pageProgressionDirection
        const [width, height] = exth?.originalResolution?.split('x') ?? []
        this.rendition = {
            layout: exth?.fixedLayout === 'true' ? 'pre-paginated' : 'reflowable',
            viewport: { width, height },
        }

        this.metadata = this.mobi.getMetadata()
        return this
    }
    getCover() { return this.mobi.getCover() }
    // is this really the only way of getting to RESC, PAGE, etc.?
    async getResourcesByMagic(keys: string[]): Promise<Partial<Record<string, number>>> {
        const results: Partial<Record<string, number>> = {}
        const start = this.#header.resourceStart
        const end = this.mobi.recordCount
        for (let i = start; i < end; i++) {
            try {
                const magic = await this.mobi.loadMagic(i)
                const match = keys.find(key => key === magic)
                if (match) results[match] = i
            } catch (error) { console.warn(`Could not inspect KF8 resource ${i}`, error) }
        }
        return results
    }
    async getGuide(): Promise<TOCItem[] | undefined> {
        const index = this.#header.guide
        if (index < 0xffffffff) {
            const loadRecord = this.mobi.loadRecord.bind(this.mobi)
            const { table, cncx } = await getIndexData(index, loadRecord)
            return table.map(({ name, tagMap }) => ({
                label: cncx[tagMap[1]?.[0] ?? -1] ?? '',
                type: name?.split(/\s/),
                href: makePosURI(tagMap[6]?.[0] ?? tagMap[3]?.[0]),
            }))
        }
    }
    async loadResourceBlob(str: string, parents: string[] = []): Promise<[Blob, Element | null]> {
        const { resourceType, id, type } = parseResourceURI(str)
        const raw = resourceType === 'flow' ? await this.loadFlow(id)
            : await this.mobi.loadResource(id - 1)
        const result = type === MIME.XHTML || type === MIME.HTML || type === MIME.CSS || type === MIME.SVG
            ? await this.replaceResources(this.mobi.decode(raw), [...parents, str]) : new Blob([raw])
        const detail: ResourceTransformDetail = { name: str, data: result, type }
        const event = new CustomEvent<ResourceTransformDetail>('data', { detail })
        this.transformTarget.dispatchEvent(event)
        const newData = await event.detail.data
        const newType = await event.detail.type
        const doc = newType === MIME.SVG
            ? this.parser.parseFromString(typeof newData === 'string' ? newData : await newData.text(), newType) : null
        return [new Blob([newData], { type: newType }),
            // SVG wrappers need to be inlined
            // as browsers don't allow external resources when loading SVG as an image
            doc?.getElementsByTagNameNS('http://www.w3.org/2000/svg', 'image')?.length
                ? doc.documentElement : null]
    }
    loadResource(str: string, parents: string[] = []): Promise<string> {
        if (this.#closed) return Promise.reject(new Error('KF8 was closed'))
        if (parents.includes(str)) return Promise.resolve('')
        const cached = this.#resourceCache.get(str)
        if (cached) return cached
        const pending = this.loadResourceBlob(str, parents).then(([blob, inline]) => {
            if (this.#closed) throw new Error('KF8 was closed')
            const url = inline ? str : URL.createObjectURL(blob)
            if (inline) this.#inlineMap.set(url, inline)
            else this.#urls.add(url)
            return url
        }).catch((error: unknown) => { this.#resourceCache.delete(str); throw error })
        this.#resourceCache.set(str, pending)
        return pending
    }
    async replaceResources(str: string, parents: string[] = []): Promise<string> {
        const regex = new RegExp(kindleResourceRegex, 'g')
        let output = '', offset = 0
        for (const match of str.matchAll(regex)) {
            output += str.slice(offset, match.index) + await this.loadResource(match[0], parents)
            offset = match.index + match[0].length
        }
        return output + str.slice(offset)
    }
    // NOTE: there doesn't seem to be a way to access text randomly?
    // how to know the decompressed size of the records without decompressing?
    // 4096 is just the maximum size
    loadRaw(start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
        const pending = this.#rawQueue.then(() => this.#loadRaw(start, end))
        // A failed request must not poison later independent reads.
        this.#rawQueue = pending.then(() => {}, () => {})
        return pending
    }
    async #loadRaw(start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
        if (this.#closed) throw new Error('KF8 was closed')
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start
            || this.#fullRawLength != null && end > this.#fullRawLength) throw new Error('Invalid KF8 text range')
        // here we load either from the front or back until we have reached the
        // required offsets; at worst you'd have to load half the book at once
        const distanceHead = end - this.#rawHead.length
        const distanceEnd = this.#fullRawLength == null ? Infinity
            : (this.#fullRawLength - this.#rawTail.length) - start
        // load from the start
        if (this.#fullRawLength == null || distanceHead < 0 || distanceHead < distanceEnd) {
            while (this.#rawHead.length < end) {
                const index = this.#lastLoadedHead + 1
                if (index >= this.mobi.headers.palmdoc.numTextRecords) throw new Error('KF8 text range exceeds available records')
                const data = await this.mobi.loadText(index)
                if (this.#closed) throw new Error('KF8 was closed')
                this.#rawHead = concatTypedArray(this.#rawHead, data)
                this.#lastLoadedHead = index
            }
            return this.#rawHead.slice(start, end)
        }
        // load from the end
        while (this.#fullRawLength - this.#rawTail.length > start) {
            const index = this.mobi.headers.palmdoc.numTextRecords - 1
                - (this.#lastLoadedTail + 1)
            if (index < 0) throw new Error('KF8 text range exceeds available records')
            const data = await this.mobi.loadText(index)
            if (this.#closed) throw new Error('KF8 was closed')
            this.#rawTail = concatTypedArray(data, this.#rawTail)
            this.#lastLoadedTail++
        }
        const rawTailStart = this.#fullRawLength - this.#rawTail.length
        return this.#rawTail.slice(start - rawTailStart, end - rawTailStart)
    }
    loadFlow(index: number) {
        const range = this.#flows?.[index]
        if (!range) throw new Error(`Missing KF8 flow ${index}`)
        return this.loadRaw(...range)
    }
    async loadText(section: KF8Section) {
        const { skel, frags, length } = section
        const raw = await this.loadRaw(skel.offset, skel.offset + length)
        let skeleton = raw.slice(0, skel.length)
        for (const frag of frags) {
            const insertOffset = frag.insertOffset - skel.offset
            const offset = skel.length + frag.offset
            const fragRaw = raw.slice(offset, offset + frag.length)
            skeleton = concatTypedArray3(
                skeleton.slice(0, insertOffset), fragRaw,
                skeleton.slice(insertOffset))

            const offsets = this.#fragmentOffsets.get(frag.index)
            if (offsets) for (const offset of offsets) {
                const str = this.mobi.decode(fragRaw.slice(offset))
                const selector = getFragmentSelector(str)
                this.#setFragmentSelector(frag.index, offset, selector)
            }
        }
        return this.mobi.decode(skeleton)
    }
    async createDocument(section: KF8Section) {
        const str = await this.loadText(section)
        return this.parser.parseFromString(str, this.#type)
    }
    loadSection(section: KF8Section): Promise<string> {
        if (this.#closed) return Promise.reject(new Error('KF8 was closed'))
        const cached = this.#sectionCache.get(section)
        if (cached) return cached
        const pending = this.#loadSection(section).catch((error: unknown) => { this.#sectionCache.delete(section); throw error })
        this.#sectionCache.set(section, pending)
        return pending
    }
    async #loadSection(section: KF8Section): Promise<string> {
        const str = await this.loadText(section)
        const replaced = await this.replaceResources(str)

        // by default, type is XHTML; change to HTML if it's not valid XHTML
        let doc = this.parser.parseFromString(replaced, this.#type)
        if (doc.querySelector('parsererror') || !doc.documentElement?.namespaceURI) {
            this.#type = MIME.HTML
            doc = this.parser.parseFromString(replaced, this.#type)
        }
        for (const [url, node] of this.#inlineMap) {
            for (const el of doc.querySelectorAll(`img[src="${url}"]`))
                el.replaceWith(doc.importNode(node, true))
        }
        if (this.#closed) throw new Error('KF8 was closed')
        const url = URL.createObjectURL(
            new Blob([this.serializer.serializeToString(doc)], { type: this.#type }))
        this.#urls.add(url)
        return url
    }
    getIndexByFID(fid: number) {
        return this.#sections.findIndex(section =>
            section.frags.some(frag => frag.index === fid))
    }
    #setFragmentSelector(id: number, offset: number, selector: string | undefined) {
        const map = this.#fragmentSelectors.get(id)
        if (map) map.set(offset, selector)
        else {
            const map = new Map<number, string | undefined>()
            this.#fragmentSelectors.set(id, map)
            map.set(offset, selector)
        }
    }
    async resolveHref(href: string) {
        const pos = parsePosURI(href)
        if (!pos) return
        const { fid, off } = pos
        const index = this.getIndexByFID(fid)
        if (index < 0) return

        const saved = this.#fragmentSelectors.get(fid)?.get(off)
        if (saved) return { index, anchor: (doc: Document) => doc.querySelector(saved) }

        const { skel, frags } = this.#sections[index]
        const frag = frags.find(frag => frag.index === fid)
        if (!frag) return
        const offset = skel.offset + skel.length + frag.offset
        const fragRaw = await this.loadRaw(offset, offset + frag.length)
        const str = this.mobi.decode(fragRaw.slice(off))
        const selector = getFragmentSelector(str)
        this.#setFragmentSelector(fid, off, selector)
        const anchor = (doc: Document) => selector ? doc.querySelector(selector) : null
        return { index, anchor }
    }
    splitTOCHref(href: string): [number, { fid: number; off: number } | null] {
        const pos = parsePosURI(href)
        if (!pos) return [-1, null]
        const index = this.getIndexByFID(pos.fid)
        return [index, pos]
    }
    getTOCFragment(doc: Document, pos: TOCFragment | undefined) {
        if (!pos || typeof pos !== 'object') return null
        const selector = this.#fragmentSelectors.get(pos.fid)?.get(pos.off)
        return selector ? doc.querySelector(selector) : null
    }
    // READAWARE: a navigable `kindle:pos:` href for a section — its first
    // fragment at offset 0 (see MOBI6's getSectionHref for the why).
    getSectionHref(index: number) {
        const fid = this.#sections[index]?.frags?.[0]?.index
        return fid == null ? undefined : makePosURI(fid, 0)
    }
    isExternal(uri: string) {
        return /^(?!blob|kindle)\w+:/i.test(uri)
    }
    destroy() {
        this.#closed = true
        for (const url of this.#urls) URL.revokeObjectURL(url)
        this.#urls.clear()
        this.#resourceCache.clear()
        this.#sectionCache.clear()
        this.#inlineMap.clear()
        this.#fragmentSelectors.clear()
        this.#rawHead = new Uint8Array()
        this.#rawTail = new Uint8Array()
    }
}
