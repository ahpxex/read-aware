import type { Book, BookMetadata, BookSection, MediaMetadata, Rendition, TOCFragment, TOCItem } from './book.js'
import { NS, MIME, isExternal, resolveURL } from './epub-dom.js'
import { getMetadata } from './epub-metadata.js'
import { getDisplayOptions, getHTMLFragment, getPageSpread, parseNav, parseNCX } from './epub-navigation.js'
import { Encryption, Resources } from './epub-resources.js'
import type { Archive, ManifestItem, SHA1 } from './epub-resources.js'
import { Loader } from './epub-loader.js'
import { MediaOverlay } from './media-overlay.js'

export class EPUB implements Book {
    readonly loadText: Archive['loadText']
    readonly loadBlob: Archive['loadBlob']
    readonly getSize: Archive['getSize']
    readonly parser = new DOMParser()
    sections: BookSection[] = []
    metadata: BookMetadata = {}
    rendition: Rendition = {}
    media: MediaMetadata = {}
    toc: TOCItem[] | null = null
    pageList: TOCItem[] | null = null
    landmarks: TOCItem[] | null = null
    dir: string | null = null
    transformTarget: EventTarget | undefined
    #resources: Resources | undefined
    #loader: Loader | undefined
    #encryption: Encryption
    #overlays = new Set<MediaOverlay>()
    #closed = false

    constructor({ loadText, loadBlob, getSize, sha1 }: Archive & { sha1?: SHA1 }) {
        this.loadText = loadText
        this.loadBlob = loadBlob
        this.getSize = getSize
        this.#encryption = new Encryption(sha1)
    }
    get resources(): Resources {
        if (!this.#resources) throw new Error('EPUB has not been initialized')
        return this.#resources
    }
    async #loadXML(uri: string): Promise<Document | null> {
        const text = await this.loadText(uri)
        if (text == null) return null
        const doc = this.parser.parseFromString(text, MIME.XML)
        const error = doc.querySelector('parsererror')
        if (error) throw new Error(`XML parsing error: ${uri}\n${error.textContent}`)
        return doc
    }
    async init(): Promise<this> {
        try { return await this.#init() }
        catch (error) { this.destroy(); throw error }
    }
    async #init(): Promise<this> {
        if (this.#closed) throw new Error('EPUB was closed')
        const container = await this.#loadXML('META-INF/container.xml')
        if (!container) throw new Error('Failed to load container file')
        const rootfile = Array.from(container.getElementsByTagNameNS(NS.CONTAINER, 'rootfile'))
            .find(el => el.getAttribute('media-type') === 'application/oebps-package+xml')
        const opfPath = rootfile?.getAttribute('full-path')
        if (!opfPath) throw new Error('No package document defined in container')
        const opf = await this.#loadXML(opfPath)
        if (!opf) throw new Error('Failed to load package document')
        await this.#encryption.init(await this.#loadXML('META-INF/encryption.xml'), opf)
        if (this.#closed) throw new Error('EPUB was closed')
        this.#resources = new Resources(opf, href => resolveURL(href, opfPath))
        const loader = new Loader({
            loadText: this.loadText,
            loadBlob: async href => {
                const blob = await this.loadBlob(href)
                return blob ? this.#encryption.decode(href, blob) : null
            },
        }, this.resources)
        this.#loader = loader
        this.transformTarget = loader.eventTarget
        this.sections = this.resources.spine.map(({ item, linear, properties, cfi }) => ({
            id: item.href, linear, cfi, size: this.getSize(item.href) ?? 0,
            pageSpread: getPageSpread(properties),
            load: async () => {
                const url = await loader.loadItem(item)
                if (!url) throw new Error(`EPUB section was not loaded: ${item.href}`)
                return url
            },
            unload: () => loader.unloadItem(item),
            createDocument: () => this.loadDocument(item),
            resolveHref: href => resolveURL(href, item.href),
            mediaOverlay: this.resources.getItemByID(item.mediaOverlay),
        }))
        if (!this.sections.length) throw new Error('EPUB has no readable sections')
        const { navPath, ncxPath } = this.resources
        if (navPath) try {
            const doc = await this.#loadXML(navPath)
            if (!doc) throw new Error('Missing EPUB navigation document')
            const nav = parseNav(doc, href => resolveURL(href, navPath))
            this.toc = nav.toc
            this.pageList = nav.pageList
            this.landmarks = nav.landmarks
        } catch (error) { console.warn('Could not read EPUB navigation', error) }
        if (!this.toc && ncxPath) try {
            const doc = await this.#loadXML(ncxPath)
            if (!doc) throw new Error('Missing EPUB NCX document')
            const ncx = parseNCX(doc, href => resolveURL(href, ncxPath))
            this.toc = ncx.toc
            this.pageList ??= ncx.pageList
        } catch (error) { console.warn('Could not read EPUB NCX navigation', error) }
        this.landmarks ??= this.resources.guide ?? null
        const { metadata, rendition, media } = getMetadata(opf)
        this.metadata = metadata
        this.rendition = rendition
        this.media = media
        this.dir = this.resources.pageProgressionDirection
        const display = getDisplayOptions(
            await this.#loadXML('META-INF/com.apple.ibooks.display-options.xml')
            ?? await this.#loadXML('META-INF/com.kobobooks.display-options.xml'))
        if (display?.fixedLayout === 'true') this.rendition.layout ??= 'pre-paginated'
        const firstLinear = this.sections.find(section => section.linear !== 'no')
        if (display?.openToSpread === 'false' && firstLinear)
            firstLinear.pageSpread ??= this.dir === 'rtl' ? 'left' : 'right'
        if (this.#closed) throw new Error('EPUB was closed')
        return this
    }
    async loadDocument(item: ManifestItem): Promise<Document> {
        const text = await this.loadText(item.href)
        if (text == null) throw new Error(`Missing EPUB document: ${item.href}`)
        const type = item.mediaType === MIME.SVG ? MIME.SVG : item.mediaType === MIME.HTML ? MIME.HTML : MIME.XHTML
        const doc = this.parser.parseFromString(text, type)
        if (type === MIME.XHTML && (doc.querySelector('parsererror') || !doc.documentElement.namespaceURI)) {
            console.warn(`Parsing invalid EPUB XHTML as HTML: ${item.href}`)
            return this.parser.parseFromString(text, MIME.HTML)
        }
        return doc
    }
    getMediaOverlay(): MediaOverlay {
        const overlay = new MediaOverlay(this, href => this.#loadXML(href))
        this.#overlays.add(overlay)
        return overlay
    }
    resolveCFI(cfi: string) { return this.resources.resolveCFI(cfi) }
    resolveHref(href: string) {
        const [path, hash] = href.split('#')
        const index = this.sections.findIndex(section => section.id === decodeURI(path))
        if (index < 0) return null
        return { index, anchor: (doc: Document) => hash ? getHTMLFragment(doc, decodeURIComponent(hash)) : 0 }
    }
    splitTOCHref(href: string): [string, string?] {
        const [path, hash] = href.split('#')
        return [decodeURI(path), hash ? decodeURIComponent(hash) : undefined]
    }
    getSectionHref(index: number) {
        const section = this.sections[index]
        return section ? String(section.id) : undefined
    }
    getTOCFragment(doc: Document, id: TOCFragment | undefined) {
        return typeof id === 'string' ? getHTMLFragment(doc, id) : doc.documentElement
    }
    isExternal(uri: string) { return isExternal(uri) }
    async getCover(): Promise<Blob | null> {
        const cover = this.resources.cover
        if (!cover) return null
        const blob = await this.loadBlob(cover.href)
        return blob ? new Blob([blob], { type: cover.mediaType }) : null
    }
    async getCalibreBookmarks(): Promise<unknown> {
        const text = await this.loadText('META-INF/calibre_bookmarks.txt')
        const magic = 'encoding=json+base64:'
        if (text?.startsWith(magic)) return JSON.parse(atob(text.slice(magic.length)))
    }
    destroy() {
        this.#closed = true
        for (const overlay of this.#overlays) overlay.stop()
        this.#overlays.clear()
        this.#loader?.destroy()
    }
}
