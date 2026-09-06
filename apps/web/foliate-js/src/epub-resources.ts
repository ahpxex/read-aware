import * as CFI from './epubcfi.js'
import type { MaybePromise, ResolvedNavigation, TOCItem } from './book.js'
import { NS, MIME, childGetter, getElementText, getIdentifier } from './epub-dom.js'
import { UnsupportedEncryptionError } from './errors.js'

export type Archive = {
    loadText: (href: string) => MaybePromise<string | null | undefined>
    loadBlob: (href: string) => MaybePromise<Blob | null | undefined>
    getSize: (href: string) => number | undefined
}
export type ManifestItem = {
    id: string; href: string; mediaType: string; properties: string[]; mediaOverlay: string | null
}
type SpineItem = {
    idref: string; id: string | null; linear: string | null; properties: string[]
    item: ManifestItem; cfi: string
}

export class Resources {
    readonly manifest: ManifestItem[] = []
    readonly manifestById: Map<string, ManifestItem>
    readonly spine: SpineItem[] = []
    readonly pageProgressionDirection: string | null
    readonly navPath: string | undefined
    readonly ncxPath: string | undefined
    readonly guide: TOCItem[] | undefined
    readonly cover: ManifestItem | undefined
    constructor(readonly opf: Document, resolveHref: (href: string) => string) {
        const { $, $$, $$$ } = childGetter(opf, NS.OPF)
        const manifest = $(opf.documentElement, 'manifest')
        const spine = $(opf.documentElement, 'spine')
        if (!manifest || !spine) throw new Error('EPUB package requires a manifest and spine')
        for (const el of $$(manifest, 'item')) {
            const id = el.getAttribute('id'), href = el.getAttribute('href'), mediaType = el.getAttribute('media-type')
            if (!id || !href || !mediaType) {
                console.warn('Ignoring incomplete EPUB manifest item', id)
                continue
            }
            this.manifest.push({ id, href: resolveHref(href), mediaType,
                properties: el.getAttribute('properties')?.split(/\s+/) ?? [],
                mediaOverlay: el.getAttribute('media-overlay') })
        }
        this.manifestById = new Map(this.manifest.map(item => [item.id, item]))
        const refs = $$(spine, 'itemref')
        const cfis = CFI.fromElements(refs)
        for (const [index, el] of refs.entries()) {
            const idref = el.getAttribute('idref')
            const item = this.getItemByID(idref)
            if (!idref || !item) {
                console.warn(`Could not find item with ID "${idref}" in EPUB manifest`)
                continue
            }
            this.spine.push({ idref, item, cfi: cfis[index], id: el.getAttribute('id'),
                linear: el.getAttribute('linear'), properties: el.getAttribute('properties')?.split(/\s+/) ?? [] })
        }
        this.pageProgressionDirection = spine.getAttribute('page-progression-direction')
        this.navPath = this.getItemByProperty('nav')?.href
        this.ncxPath = (this.getItemByID(spine.getAttribute('toc'))
            ?? this.manifest.find(item => item.mediaType === MIME.NCX))?.href
        const guide = $(opf.documentElement, 'guide')
        if (guide) this.guide = $$(guide, 'reference').map(el => {
            const href = el.getAttribute('href')
            return { label: el.getAttribute('title') ?? undefined,
                type: el.getAttribute('type')?.split(/\s+/) ?? [], href: href ? resolveHref(href) : null }
        })
        this.cover = this.getItemByProperty('cover-image')
            ?? this.getItemByID($$$(opf, 'meta').find(el => el.getAttribute('name') === 'cover')?.getAttribute('content'))
            ?? this.getItemByHref(this.guide?.find(ref => ref.type?.includes('cover'))?.href)
    }
    getItemByID(id: string | null | undefined) { return id ? this.manifestById.get(id) : undefined }
    getItemByHref(href: string | null | undefined) { return this.manifest.find(item => item.href === href) }
    getItemByProperty(property: string) { return this.manifest.find(item => item.properties.includes(property)) }
    resolveCFI(cfi: string): ResolvedNavigation {
        const parts = CFI.parse(cfi)
        const top = (Array.isArray(parts) ? parts : parts.parent).shift()
        if (!top?.length) throw new Error('EPUB CFI has no package path')
        let itemref = CFI.toElement(this.opf, top)
        // Older Epub.js versions used a manifest ID in place of the spine ID.
        if (itemref?.localName !== 'itemref') {
            delete top[top.length - 1].id
            itemref = CFI.toElement(this.opf, top)
        }
        const idref = itemref?.getAttribute('idref')
        const index = this.spine.findIndex(item => item.idref === idref)
        if (index < 0) throw new Error('EPUB CFI points outside the reading order')
        return { index, anchor: doc => CFI.toRange(doc, parts) }
    }
}

export type SHA1 = (text: string) => MaybePromise<Uint8Array>
type Decoder = (blob: Blob) => MaybePromise<Blob>
type Obfuscation = { key: (opf: Document) => MaybePromise<Uint8Array>; decode: (key: Uint8Array, blob: Blob) => Promise<Blob> }
const deobfuscate = async (key: Uint8Array, length: number, blob: Blob) => {
    const bytes = new Uint8Array(await blob.slice(0, length).arrayBuffer())
    for (let i = 0; i < bytes.length; i++) bytes[i] ^= key[i % key.length]
    return new Blob([bytes, blob.slice(bytes.length)], { type: blob.type })
}
const webCryptoSHA1: SHA1 = async text => new Uint8Array(
    await globalThis.crypto.subtle.digest('SHA-1', new TextEncoder().encode(text)))

export class Encryption {
    #decoders = new Map<string, Decoder>()
    constructor(private readonly sha1: SHA1 = webCryptoSHA1) {}
    async init(encryption: Document | null, opf: Document) {
        if (!encryption) return
        const algorithms: Record<string, Obfuscation | undefined> = {
            'http://www.idpf.org/2008/embedding': {
                key: opf => this.sha1(getIdentifier(opf).replace(/[\u0020\u0009\u000d\u000a]/g, '')),
                decode: (key, blob) => deobfuscate(key, 1040, blob),
            },
            'http://ns.adobe.com/pdf/enc#RC': {
                key: opf => {
                    const identifiers = Array.from(opf.getElementsByTagNameNS(NS.DC, 'identifier'), getElementText)
                    const uuid = identifiers.map(value => value.split(':').at(-1) ?? '')
                        .find(value => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
                    if (!uuid) throw new Error('Adobe font obfuscation requires a UUID identifier')
                    const hex = uuid.replaceAll('-', '')
                    return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16))
                },
                decode: (key, blob) => deobfuscate(key, 1024, blob),
            },
        }
        const decoders = new Map<string, Decoder>()
        for (const el of encryption.getElementsByTagNameNS(NS.ENC, 'EncryptedData')) {
            const algorithm = el.getElementsByTagNameNS(NS.ENC, 'EncryptionMethod')[0]?.getAttribute('Algorithm')
            const uri = el.getElementsByTagNameNS(NS.ENC, 'CipherReference')[0]?.getAttribute('URI')
            if (!algorithm || !uri) throw new Error('Incomplete EPUB encryption descriptor')
            let decoder = decoders.get(algorithm)
            if (!decoder) {
                const implementation = algorithms[algorithm]
                if (!implementation) throw new UnsupportedEncryptionError('EPUB', algorithm)
                const key = await implementation.key(opf)
                if (!key.length) throw new Error('EPUB font obfuscation key is empty')
                decoder = blob => implementation.decode(key, blob)
                decoders.set(algorithm, decoder)
            }
            this.#decoders.set(decodeURI(uri), decoder)
        }
    }
    decode(uri: string, blob: Blob): MaybePromise<Blob> { return this.#decoders.get(uri)?.(blob) ?? blob }
}
