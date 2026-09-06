import * as CFI from './epubcfi.js'
import type { Book, NavigationTarget, ResolvedNavigation, TOCFragment, TOCItem } from './book.js'
import { makeBook, type BookInput } from './book-loader.js'
import { TOCProgress, SectionProgress } from './progress.js'
import { Overlayer, type DrawFunction, type DrawOptions } from './overlayer.js'
import { textWalker } from './text-walker.js'
import type { Paginator } from './paginator.js'
import type { FixedLayout } from './fixed-layout.js'
import type { TTS } from './tts.js'
import type { Content, LoadDetail, RelocateDetail, CreateOverlayerDetail } from './renderer.js'
import type { SearchMatcherOptions } from './search.js'
import { History, type HistoryDetail } from './history.js'
import { CursorAutohider } from './cursor-autohider.js'
import { anchorRange, anchorValue, eventElement, languageInfo, type LanguageInfo } from './navigation.js'
import { ViewMedia } from './view-media.js'
import { searchBook, type SearchHit } from './book-search.js'

export { makeBook, ResponseError, NotFoundError, UnsupportedTypeError } from './book-loader.js'
export type Renderer = Paginator | FixedLayout
export type Annotation = { value: string; overlayKey?: string; color?: string }
export type DrawAnnotationDetail = {
    draw: (func: DrawFunction, options?: DrawOptions) => void
    annotation: Annotation
    doc: Document
    range: Range
}
export type ShowAnnotationDetail = { value: string; index: number; range: Range }
export type LinkDetail = { a: Element; href: string }
export type Location = ReturnType<SectionProgress['getProgress']> & {
    tocItem?: TOCItem | null
    pageItem?: TOCItem | null
    cfi: string
    range: Range | null
}
export type ViewRelocateDetail = Location & Pick<RelocateDetail, 'reason'>
export type ViewSearchOptions = SearchMatcherOptions & {
    query: string; index?: number; draw?: DrawFunction; drawOptions?: DrawOptions
}
export type ViewSearchResult = SearchHit | { progress: number } | { label: string; subitems: SearchHit[] } | 'done'

const SEARCH_PREFIX = 'foliate-search:'
const aborted = () => new DOMException('View was closed or replaced', 'AbortError')

export class View extends HTMLElement {
    #book: Book | undefined
    #ownedBook: Book | undefined
    #renderer: Renderer | undefined
    #root = this.attachShadow({ mode: 'closed' })
    #generation = 0
    #navigation = 0
    #events = new AbortController()
    #sectionProgress: SectionProgress | undefined
    #tocProgress: TOCProgress<string | number, TOCFragment> | undefined
    #pageProgress: TOCProgress<string | number, TOCFragment> | undefined
    #searchController = new AbortController()
    #searchResults = new Map<number, Annotation[]>()
    #searchDraw: DrawFunction = Overlayer.outline
    #searchDrawOptions: DrawOptions = {}
    #cursorAutohider = new CursorAutohider(this, () => this.hasAttribute('autohide-cursor'))
    #documentCursors = new Set<CursorAutohider>()
    #docsSetup = new WeakSet<Document>()
    #overlayerClickHandlers = new WeakMap<Document, (event: MouseEvent) => void>()
    #lastRelocateDetail: RelocateDetail | undefined
    #media: ViewMedia | undefined
    language: LanguageInfo = {}
    isFixedLayout = false
    lastLocation: Location | null = null
    tts: TTS | undefined
    readonly history = new History()
    get book() { return this.#book }
    get renderer() { return this.#renderer }
    get mediaOverlay() { return this.#media?.overlay }
    #requireBook(): Book {
        if (!this.#book) throw new Error('No book is open')
        return this.#book
    }
    #requireRenderer(): Renderer {
        if (!this.#renderer) throw new Error('No renderer is open')
        return this.#renderer
    }
    constructor() {
        super()
        this.history.addEventListener('popstate', event => {
            const { state } = (event as CustomEvent<HistoryDetail>).detail
            void this.#navigate(state).catch(error => console.error('Could not restore navigation history', error))
        })
    }
    async open(input: Book | BookInput): Promise<void> {
        const closing = this.close()
        const generation = this.#generation
        await closing
        if (generation !== this.#generation) throw aborted()
        const owned = typeof input === 'string' || !('sections' in input)
        const book = typeof input === 'string' || !('sections' in input) ? await makeBook(input) : input
        if (generation !== this.#generation) {
            if (owned) await book.destroy?.()
            throw aborted()
        }
        this.#book = book
        this.#ownedBook = owned ? book : undefined
        this.language = languageInfo(book.metadata?.language)
        this.#sectionProgress = new SectionProgress(book.sections, 1500, 1600)
        this.isFixedLayout = book.rendition?.layout === 'pre-paginated'
        try {
            const renderer = this.isFixedLayout
                ? new (await import('./fixed-layout.js')).FixedLayout()
                : new (await import('./paginator.js')).Paginator()
            if (generation !== this.#generation) { renderer.destroy(); throw aborted() }
            this.#renderer = renderer
            renderer.setAttribute('exportparts', 'head,foot,filter')
            const options = { signal: this.#events.signal }
            renderer.addEventListener('load', event => this.#onLoad((event as CustomEvent<LoadDetail>).detail), options)
            renderer.addEventListener('relocate', event => this.#onRelocate((event as CustomEvent<RelocateDetail>).detail), options)
            renderer.addEventListener('create-overlayer', event => {
                const detail = (event as CustomEvent<CreateOverlayerDetail>).detail
                detail.attach(this.#createOverlayer(detail))
            }, options)
            renderer.open(book)
            this.#root.append(renderer)
            this.#initProgress(book, generation)
            if (book.sections.some(section => section.mediaOverlay)) this.#media = new ViewMedia(book,
                href => this.#navigate(href), () => renderer.getContents())
        } catch (error) {
            if (generation === this.#generation) await this.close()
            throw error
        }
    }
    #initProgress(book: Book, generation: number) {
        if (!book.splitTOCHref || !book.getTOCFragment) return
        const ids = book.sections.map(section => section.id)
        const splitHref = book.splitTOCHref.bind(book), getFragment = book.getTOCFragment.bind(book)
        const toc = this.#tocProgress = new TOCProgress<string | number, TOCFragment>()
        const pages = this.#pageProgress = new TOCProgress<string | number, TOCFragment>()
        // Outline resolution must not block the first page or update a replacement book.
        void Promise.all([
            toc.init({ toc: book.toc ?? [], ids, splitHref, getFragment }),
            pages.init({ toc: book.pageList ?? [], ids, splitHref, getFragment }),
        ]).then(() => {
            if (generation === this.#generation && this.#lastRelocateDetail)
                this.#onRelocate({ ...this.#lastRelocateDetail, reason: 'anchor' })
        }).catch(error => console.error('Could not initialize reading progress', error))
    }
    close(): Promise<void> {
        this.#generation++
        this.#navigation++
        this.clearSearch()
        this.#media?.destroy()
        this.#media = undefined
        this.#events.abort()
        this.#events = new AbortController()
        for (const cursor of this.#documentCursors) cursor.destroy()
        this.#documentCursors.clear()
        this.#cursorAutohider.show()
        this.#renderer?.destroy()
        this.#renderer?.remove()
        this.#renderer = undefined
        this.#docsSetup = new WeakSet()
        this.#overlayerClickHandlers = new WeakMap()
        this.#sectionProgress = undefined
        this.#tocProgress = this.#pageProgress = undefined
        this.#lastRelocateDetail = undefined
        this.lastLocation = null
        this.history.clear()
        this.tts = undefined
        const owned = this.#ownedBook
        this.#book = this.#ownedBook = undefined
        this.language = {}
        this.isFixedLayout = false
        return Promise.resolve(owned?.destroy?.())
    }
    goToTextStart() {
        const book = this.#requireBook()
        return this.goTo(book.landmarks?.find(item => item.type?.some(type => type === 'bodymatter' || type === 'text'))?.href
            ?? book.sections.findIndex(section => section.linear !== 'no'))
    }
    async init({ lastLocation, showTextStart = false }: { lastLocation?: NavigationTarget | null; showTextStart?: boolean } = {}) {
        if (lastLocation != null && await this.goTo(lastLocation)) return
        if (showTextStart) await this.goToTextStart()
        else await this.goTo(this.#requireBook().sections.findIndex(section => section.linear !== 'no'))
    }
    #emit<T>(name: string, detail: T, cancelable = false) {
        return this.dispatchEvent(new CustomEvent<T>(name, { detail, cancelable }))
    }
    #onRelocate(detail: RelocateDetail) {
        if (!this.#sectionProgress || !this.#book?.sections[detail.index]) return
        const { reason, range, index, fraction, size } = detail
        this.#lastRelocateDetail = detail
        const progress = this.#sectionProgress.getProgress(index, fraction, size)
        const { tocItem, pageItem } = this.getProgressOf(index, range)
        const cfi = this.getCFI(index, range)
        this.lastLocation = { ...progress, tocItem, pageItem, cfi, range }
        if (reason === 'snap' || reason === 'page' || reason === 'scroll') this.history.replaceState(cfi)
        this.#emit<ViewRelocateDetail>('relocate', { ...this.lastLocation, reason })
    }
    #onLoad({ doc, index }: LoadDetail) {
        doc.documentElement.lang ||= this.language.canonical ?? ''
        if (!this.language.isCJK) doc.documentElement.dir ||= this.language.direction ?? ''
        if (!this.#docsSetup.has(doc)) {
            this.#docsSetup.add(doc)
            this.#handleLinks(doc, index)
            this.#documentCursors.add(this.#cursorAutohider.cloneFor(doc.documentElement))
        }
        this.#emit<LoadDetail>('load', { doc, index })
    }
    #handleLinks(doc: Document, index: number) {
        const book = this.#requireBook(), section = book.sections[index]
        doc.addEventListener('click', event => {
            const a = eventElement(event.target)?.closest('a[href]')
            const raw = a?.getAttribute('href')
            if (!a || raw == null) return
            event.preventDefault()
            const href = section?.resolveHref?.(raw) ?? raw
            if (book.isExternal?.(href)) {
                if (this.#emit('external-link', { a, href, href_: raw }, true)) globalThis.open(href, '_blank')
            } else if (this.#emit<LinkDetail>('link', { a, href }, true))
                void this.goTo(href).catch(error => console.error('Could not follow book link', error))
        }, { signal: this.#events.signal })
    }
    async addAnnotation(annotation: Annotation, remove = false) {
        const generation = this.#generation, searchSignal = this.#searchController.signal
        const { value, overlayKey = value } = annotation
        const search = value.startsWith(SEARCH_PREFIX)
        const resolved = await this.resolveNavigation(search ? value.slice(SEARCH_PREFIX.length) : value)
        if (!resolved || generation !== this.#generation || search && searchSignal.aborted) return
        const { index, anchor } = resolved
        const content = this.#getOverlayer(index)
        if (content) {
            const { overlayer, doc } = content
            overlayer.remove(overlayKey)
            if (!remove) {
                const range = anchorRange(doc, anchorValue(doc, anchor))
                if (range) {
                    const draw = (func: DrawFunction, options: DrawOptions = {}) => overlayer.add(overlayKey, range, func, options, value)
                    if (search) draw(this.#searchDraw, this.#searchDrawOptions)
                    else this.#emit<DrawAnnotationDetail>('draw-annotation', { draw, annotation, doc, range })
                }
            }
        }
        return { index, label: this.#tocProgress?.getProgress(index)?.label ?? '' }
    }
    deleteAnnotation(annotation: Annotation) { return this.addAnnotation(annotation, true) }
    #getOverlayer(index: number) {
        return this.#renderer?.getContents().find((content): content is Content & { overlayer: Overlayer } =>
            content.index === index && !!content.overlayer)
    }
    #createOverlayer({ doc, index }: LoadDetail) {
        const overlayer = new Overlayer()
        const previous = this.#overlayerClickHandlers.get(doc)
        if (previous) doc.removeEventListener('click', previous)
        const onClick = (event: MouseEvent) => {
            const [value, range] = overlayer.hitTest(event)
            if (value && range && !value.startsWith(SEARCH_PREFIX))
                this.#emit<ShowAnnotationDetail>('show-annotation', { value, index, range })
        }
        this.#overlayerClickHandlers.set(doc, onClick)
        doc.addEventListener('click', onClick, { signal: this.#events.signal })
        for (const item of this.#searchResults.get(index) ?? [])
            void this.addAnnotation(item).catch(error => console.error('Could not restore search highlight', error))
        this.#emit('create-overlay', { index })
        return overlayer
    }
    async showAnnotation({ value }: Annotation) {
        const resolved = await this.goTo(value)
        if (!resolved) return
        const content = this.#getOverlayer(resolved.index)
        const range = content && anchorRange(content.doc, anchorValue(content.doc, resolved.anchor))
        if (range) this.#emit<ShowAnnotationDetail>('show-annotation', { value, index: resolved.index, range })
    }
    getCFI(index: number, range?: Range | null): string {
        const section = this.#requireBook().sections[index]
        if (!section) throw new RangeError('Invalid CFI section: ' + index)
        const base = section.cfi ?? CFI.fake.fromIndex(index)
        return range ? CFI.joinIndir(base, CFI.fromRange(range)) : base
    }
    resolveCFI(cfi: string): ResolvedNavigation {
        const book = this.#requireBook()
        if (book.resolveCFI) return book.resolveCFI(cfi)
        const parts = CFI.parse(cfi)
        const parent = Array.isArray(parts) ? parts : parts.parent
        const base = parent.shift()
        if (!base) throw new Error('CFI has no section path')
        const index = CFI.fake.toIndex(base)
        return { index, anchor: doc => CFI.toRange(doc, parts) }
    }
    async resolveNavigation(target: NavigationTarget): Promise<ResolvedNavigation | undefined> {
        const book = this.#requireBook()
        let resolved: ResolvedNavigation | null | undefined
        if (typeof target === 'number') resolved = { index: target }
        else if (typeof target === 'object') {
            if ('fraction' in target) {
                if (!Number.isFinite(target.fraction)) return
                const position = this.#sectionProgress?.getSection(target.fraction)
                if (position) resolved = { index: position[0], anchor: position[1] }
            } else resolved = target
        } else resolved = CFI.isCFI.test(target) ? this.resolveCFI(target) : await book.resolveHref?.(target)
        if (resolved && Number.isInteger(resolved.index) && book.sections[resolved.index]) return resolved
    }
    async #navigate(target: NavigationTarget, select = false): Promise<ResolvedNavigation | undefined> {
        const renderer = this.#requireRenderer(), generation = this.#generation, navigation = ++this.#navigation
        const resolved = await this.resolveNavigation(target)
        if (!resolved || generation !== this.#generation || navigation !== this.#navigation) return
        await renderer.goTo(select ? { ...resolved, select: true } : resolved)
        if (generation === this.#generation && navigation === this.#navigation) return resolved
    }
    async goTo(target: NavigationTarget) {
        const resolved = await this.#navigate(target)
        if (resolved) this.history.pushState(target)
        return resolved
    }
    async goToFraction(fraction: number) { await this.goTo({ fraction }) }
    async select(target: NavigationTarget) {
        if (await this.#navigate(target, true)) this.history.pushState(target)
    }
    deselect() {
        for (const { doc } of this.#requireRenderer().getContents()) doc.defaultView?.getSelection()?.removeAllRanges()
    }
    getSectionFractions() { return (this.#sectionProgress?.sectionFractions ?? []).map(value => value + Number.EPSILON) }
    getProgressOf(index: number, range?: Range | null) {
        return { tocItem: this.#tocProgress?.getProgress(index, range), pageItem: this.#pageProgress?.getProgress(index, range) }
    }
    async getTOCItemOf(target: NavigationTarget) {
        const book = this.#requireBook(), generation = this.#generation
        const resolved = await this.resolveNavigation(target)
        if (!resolved) return
        const doc = await book.sections[resolved.index].createDocument?.()
        if (generation !== this.#generation) return
        const range = doc ? anchorRange(doc, anchorValue(doc, resolved.anchor)) : null
        return this.#tocProgress?.getProgress(resolved.index, range)
    }
    async prev(distance?: number) { this.#navigation++; await this.#requireRenderer().prev(distance) }
    async next(distance?: number) { this.#navigation++; await this.#requireRenderer().next(distance) }
    goLeft() { return this.#requireBook().dir === 'rtl' ? this.next() : this.prev() }
    goRight() { return this.#requireBook().dir === 'rtl' ? this.prev() : this.next() }
    async *search(options: ViewSearchOptions): AsyncGenerator<ViewSearchResult> {
        this.clearSearch()
        const { signal } = this.#searchController
        this.#searchDraw = options.draw ?? Overlayer.outline
        this.#searchDrawOptions = options.drawOptions ?? {}
        const list: Annotation[] = []
        if (options.index != null) this.#searchResults.set(options.index, list)
        const iter = searchBook(this.#requireBook(), options.query, options.index,
            { defaultLocale: this.language.canonical, ...options }, (index, range) => this.getCFI(index, range), signal)
        for await (const result of iter) {
            if (signal.aborted) return
            if ('subitems' in result) {
                const items = result.subitems.map(({ cfi }) => ({ value: SEARCH_PREFIX + cfi }))
                this.#searchResults.set(result.index, items)
                for (const item of items) { if (signal.aborted) return; await this.addAnnotation(item) }
                yield { label: this.#tocProgress?.getProgress(result.index)?.label ?? '', subitems: result.subitems }
            } else {
                if ('cfi' in result) {
                    const item = { value: SEARCH_PREFIX + result.cfi }
                    list.push(item)
                    await this.addAnnotation(item)
                }
                if (signal.aborted) return
                yield result
            }
        }
        if (!signal.aborted) yield 'done'
    }
    clearSearch() {
        this.#searchController.abort()
        this.#searchController = new AbortController()
        for (const { overlayer, index } of this.#renderer?.getContents() ?? [])
            for (const item of this.#searchResults.get(index) ?? []) overlayer?.remove(item.overlayKey ?? item.value)
        this.#searchResults.clear()
    }
    async initTTS(granularity: Intl.SegmenterOptions['granularity'] = 'word', highlight?: (range: Range) => void) {
        const renderer = this.#requireRenderer(), generation = this.#generation
        const content = renderer.getContents()[0]
        if (!content || this.tts?.doc === content.doc) return
        const { TTS } = await import('./tts.js')
        if (generation !== this.#generation) return
        this.tts = new TTS(content.doc, textWalker, highlight ?? (range => {
            void renderer.goTo({ index: content.index, anchor: range, select: true })
                .catch(error => console.error('Could not follow spoken text', error))
        }), granularity)
    }
    startMediaOverlay() {
        const content = this.#requireRenderer().getContents()[0]
        return content ? this.mediaOverlay?.start(content.index) : undefined
    }
}

customElements.define('foliate-view', View)
