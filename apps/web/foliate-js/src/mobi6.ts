import type { Book, BookMetadata, BookSection, TOCFragment, TOCItem } from './book.js'
import type { MOBI } from './mobi.js'
import { MIME } from './mobi-html.js'
import { concatTypedArray3 } from './mobi-binary.js'

const mbpPagebreakRegex = /<\s*(?:mbp:)?pagebreak[^>]*>/gi
const fileposRegex = /<[^<>]+filepos=['"]{0,1}(\d+)[^<>]*>/gi

const getIndent = (el: Element | null) => {
    let x = 0
    while (el) {
        const parent = el.parentElement
        if (parent) {
            const tag = parent.tagName.toLowerCase()
            if (tag === 'p') x += 1.5
            else if (tag === 'blockquote') x += 2
        }
        el = parent
    }
    return x
}

function rawBytesToString(uint8Array: Uint8Array) {
    const chunkSize = 0x8000
    let result = ''
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
        result += String.fromCharCode(...uint8Array.subarray(i, i + chunkSize))
    }
    return result
}

type LegacySection = { raw: Uint8Array; start: number; end: number }
export class MOBI6 implements Book {
    sections: BookSection[] = []
    landmarks: TOCItem[] = []
    toc: TOCItem[] | undefined
    metadata: BookMetadata = {}

    parser = new DOMParser()
    serializer = new XMLSerializer()
    #resourceCache = new Map<number, Promise<string>>()
    #textCache = new Map<LegacySection, string>()
    #cache = new Map<LegacySection, Promise<string>>()
    #urls = new Set<string>()
    #closed = false
    #sections: LegacySection[] = []
    #fileposList: Array<{ filepos: string; number: number }> = []
    #type = MIME.HTML
    constructor(readonly mobi: MOBI) {}
    async init() {
        const recordBuffers = []
        for (let i = 0; i < this.mobi.headers.palmdoc.numTextRecords; i++) {
            const buf = await this.mobi.loadText(i)
            recordBuffers.push(buf)
        }
        const totalLength = recordBuffers.reduce((sum, buf) => sum + buf.byteLength, 0)
        // load all text records in an array
        const array = new Uint8Array(totalLength)
        recordBuffers.reduce((offset, buf) => {
            array.set(new Uint8Array(buf), offset)
            return offset + buf.byteLength
        }, 0)
        // convert to string so we can use regex
        // note that `filepos` are byte offsets
        // so it needs to preserve each byte as a separate character
        // (see https://stackoverflow.com/q/50198017)
        const str = rawBytesToString(array)

        // split content into sections at each `<mbp:pagebreak>`
        this.#sections = [0]
            .concat(Array.from(str.matchAll(mbpPagebreakRegex), m => m.index))
            .map((start, i, a) => {
                const end = a[i + 1] ?? array.length
                return {
                    raw: array.subarray(start, end),
                    start: 0,
                    end: 0,
                }
            })
            // get start and end filepos for each section
            .map((section, i, arr) => {
                section.start = arr[i - 1]?.end ?? 0
                section.end = section.start + section.raw.byteLength
                return section
            })

        this.sections = this.#sections.map((section, index) => ({
            id: index,
            load: () => this.loadSection(section),
            createDocument: () => this.createDocument(section),
            size: section.end - section.start,
        }))

        // get list of all `filepos` references in the book,
        // which will be used to insert anchor elements
        // because only then can they be referenced in the DOM
        // NOTE: must be built BEFORE getGuide()/createDocument() so that sections
        // cached during init() already have anchor elements inserted.
        this.#fileposList = [...new Set(
            Array.from(str.matchAll(fileposRegex), m => m[1]))]
            .map(filepos => ({ filepos, number: Number(filepos) }))
            .sort((a, b) => a.number - b.number)

        try {
            this.landmarks = await this.getGuide()
            const tocHref = this.landmarks
                .find(({ type }) => type?.includes('toc'))?.href
            if (tocHref) {
                const target = this.resolveHref(tocHref)
                if (!target) throw new Error('Invalid MOBI TOC target')
                const doc = await this.createDocument(this.#sections[target.index])
                let lastItem: TOCItem | undefined
                let lastLevel = 0
                let lastIndent = 0
                const lastLevelOfIndent = new Map<number, number>()
                const lastParentOfLevel = new Map<number, TOCItem>()
                this.toc = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[filepos]'))
                    .reduce<TOCItem[]>((arr, a) => {
                        const indent = getIndent(a)
                        const item: TOCItem = {
                            label: (a.innerText || a.textContent)?.trim() ?? '',
                            href: `filepos:${a.getAttribute('filepos')}`,
                        }
                        const level = indent > lastIndent ? lastLevel + 1
                            : indent === lastIndent ? lastLevel
                            : lastLevelOfIndent.get(indent) ?? Math.max(0, lastLevel - 1)
                        if (level > lastLevel) {
                            if (lastItem) {
                                lastItem.subitems ??= []
                                lastItem.subitems.push(item)
                                lastParentOfLevel.set(level, lastItem)
                            }
                            else arr.push(item)
                        }
                        else {
                            const parent = lastParentOfLevel.get(level)
                            if (parent) (parent.subitems ??= []).push(item)
                            else arr.push(item)
                        }
                        lastItem = item
                        lastLevel = level
                        lastIndent = indent
                        lastLevelOfIndent.set(indent, level)
                        return arr
                    }, [])
            }
        } catch(e) {
            console.warn(e)
        }

        this.metadata = this.mobi.getMetadata()
        return this
    }
    getCover() { return this.mobi.getCover() }
    async getGuide(): Promise<TOCItem[]> {
        const doc = await this.createDocument(this.#sections[0])
        return Array.from(doc.getElementsByTagName('reference'), ref => ({
            label: ref.getAttribute('title') ?? undefined,
            type: ref.getAttribute('type')?.split(/\s/),
            href: `filepos:${ref.getAttribute('filepos')}`,
        }))
    }
    loadResource(index: number): Promise<string> {
        if (this.#closed) return Promise.reject(new Error('MOBI was closed'))
        const cached = this.#resourceCache.get(index)
        if (cached) return cached
        const pending = this.mobi.loadResource(index).then(raw => {
            if (this.#closed) throw new Error('MOBI was closed')
            const url = URL.createObjectURL(new Blob([raw]))
            this.#urls.add(url)
            return url
        }).catch(error => { this.#resourceCache.delete(index); throw error })
        this.#resourceCache.set(index, pending)
        return pending
    }
    async loadRecindex(recindex: string | null) {
        if (!recindex) throw new Error('Missing MOBI resource index')
        return this.loadResource(Number(recindex) - 1)
    }
    async replaceResources(doc: Document) {
        for (const img of doc.querySelectorAll('img[recindex]')) {
            const recindex = img.getAttribute('recindex')
            try {
                img.setAttribute('src', await this.loadRecindex(recindex))
            } catch {
                console.warn(`Failed to load image ${recindex}`)
            }
        }
        for (const media of doc.querySelectorAll('[mediarecindex]')) {
            const mediarecindex = media.getAttribute('mediarecindex')
            const recindex = media.getAttribute('recindex')
            try {
                media.setAttribute('src', await this.loadRecindex(mediarecindex))
                if (recindex) media.setAttribute('poster', await this.loadRecindex(recindex))
            } catch {
                console.warn(`Failed to load media ${mediarecindex}`)
            }
        }
        for (const a of doc.querySelectorAll('[filepos]')) {
            const filepos = a.getAttribute('filepos')
            a.setAttribute('href', `filepos:${filepos}`)
        }
    }
    async loadText(section: LegacySection): Promise<string> {
        if (this.#closed) throw new Error('MOBI was closed')
        const cached = this.#textCache.get(section)
        if (cached != null) return cached
        const { raw } = section

        // insert anchor elements for each `filepos`
        const fileposList = this.#fileposList
            .filter(({ number }) => number >= section.start && number < section.end)
            .map(obj => ({ ...obj, offset: obj.number - section.start }))
        let arr = raw
        if (fileposList.length) {
            arr = raw.subarray(0, fileposList[0].offset)
            fileposList.forEach(({ filepos, offset }, i) => {
                const next = fileposList[i + 1]
                const a = this.mobi.encode(`<a id="filepos${filepos}"></a>`)
                arr = concatTypedArray3(arr, a, raw.subarray(offset, next?.offset))
            })
        }
        const str = this.mobi.decode(arr).replaceAll(mbpPagebreakRegex, '')
        this.#textCache.set(section, str)
        return str
    }
    async createDocument(section: LegacySection) {
        const str = await this.loadText(section)
        return this.parser.parseFromString(str, this.#type)
    }
    loadSection(section: LegacySection): Promise<string> {
        if (this.#closed) return Promise.reject(new Error('MOBI was closed'))
        const cached = this.#cache.get(section)
        if (cached) return cached
        const pending = this.#loadSection(section).catch(error => { this.#cache.delete(section); throw error })
        this.#cache.set(section, pending)
        return pending
    }
    async #loadSection(section: LegacySection): Promise<string> {
        const doc = await this.createDocument(section)

        // inject default stylesheet
        const style = doc.createElement('style')
        doc.head.append(style)
        // blockquotes in MOBI seem to have only a small left margin by default
        // many books seem to rely on this, as it's the only way to set margin
        // (since there's no CSS)
        style.append(doc.createTextNode(`blockquote {
            margin-block-start: 0;
            margin-block-end: 0;
            margin-inline-start: 1em;
            margin-inline-end: 0;
        }`))

        await this.replaceResources(doc)
        const result = this.serializer.serializeToString(doc)
        if (this.#closed) throw new Error('MOBI was closed')
        const url = URL.createObjectURL(new Blob([result], { type: this.#type }))
        this.#urls.add(url)
        return url
    }
    resolveHref(href: string) {
        // READAWARE: tolerate hrefs that are not `filepos:` links.
        const filepos = href.match(/^filepos:(\d+)$/)?.[1]
        if (filepos == null) return
        const number = Number(filepos)
        const index = this.#sections.findIndex(section => section.end > number)
        if (index < 0 || !Number.isSafeInteger(number)) return
        const anchor = (doc: Document) => doc.getElementById(`filepos${filepos}`)
        return { index, anchor }
    }
    splitTOCHref(href: string): [number, string | null] {
        const filepos = href.match(/^filepos:(\d+)$/)?.[1]
        if (filepos == null) return [-1, null]
        const number = Number(filepos)
        const index = this.#sections.findIndex(section => section.end > number)
        return [index, `filepos${filepos}`]
    }
    // READAWARE: a navigable href for a section (TOC synthesis for books whose
    // own nav covers too little of the spine). Prefers a real `filepos` anchor
    // inside the section so the jump lands on an element the book declares.
    getSectionHref(index: number) {
        const section = this.#sections[index]
        if (!section) return
        const anchor = this.#fileposList.find(({ number }) =>
            number >= section.start && number < section.end)
        return `filepos:${anchor?.filepos ?? String(section.start).padStart(10, '0')}`
    }
    getTOCFragment(doc: Document, id: TOCFragment | undefined) {
        return typeof id === 'string' ? doc.getElementById(id) : null
    }
    isExternal(uri: string) {
        return /^(?!blob|filepos)\w+:/i.test(uri)
    }
    destroy() {
        this.#closed = true
        for (const url of this.#urls) URL.revokeObjectURL(url)
        this.#urls.clear()
        this.#resourceCache.clear()
        this.#cache.clear()
        this.#textCache.clear()
    }
}
