import type { MediaOverlay } from './media-overlay.js'

export type MaybePromise<T> = T | Promise<T>

/** Includes native random-access files; callers need not materialize a Blob. */
export interface BookFile {
    readonly name?: string
    readonly size: number
    readonly type: string
    arrayBuffer(): Promise<ArrayBuffer>
    slice(start?: number, end?: number, contentType?: string): BookFile
}

export type LanguageMap = Record<string, string>
export type LocalizedText = string | LanguageMap
export type Contributor = string | {
    name?: LocalizedText
    sortAs?: LocalizedText | null
    role?: string | string[]
    code?: string | null
    scheme?: string | null
}
export type Contributors = Contributor | Contributor[]
export type ContributorRole = 'author' | 'contributor' | 'artist' | 'colorist'
    | 'editor' | 'illustrator' | 'narrator' | 'translator' | 'publisher'
export type Identifier = string | { scheme: string; value: string }
export type Collection = { name: LocalizedText; position?: number | string | null }
export type BookMetadata = Partial<Record<ContributorRole, Contributors>> & {
    title?: LocalizedText
    sortAs?: LocalizedText | null
    subtitle?: string
    identifier?: string
    altIdentifier?: Identifier | Identifier[]
    language?: string | string[]
    description?: string | null
    published?: string
    modified?: string
    subject?: Contributors
    belongsTo?: { collection?: Collection | Collection[]; series?: Collection | Collection[] | null }
    source?: Identifier | Identifier[]
    rights?: string
    pageBreakSource?: string
}

export type TOCItem = {
    id?: number
    label?: string
    href: string | null
    subitems?: TOCItem[] | null
    type?: string[]
}
export type TOCFragment = string | number | { fid: number; off: number } | null
export type Anchor = Range | Element | number
export type ResolvedNavigation = {
    index: number
    anchor?: Anchor | ((doc: Document) => Anchor | null | undefined)
    select?: boolean
}
export type NavigationTarget = string | number | { fraction: number } | ResolvedNavigation
export type PageColors = { background: string; foreground?: string } | null
export type PageRenderOptions = {
    doc: Document
    scale: number
    pageColors?: PageColors
    signal?: AbortSignal
}
export type PageSource = { src: string; onZoom?: (options: PageRenderOptions) => Promise<void> }
export type BookSection = {
    id: string | number
    size: number
    load: () => MaybePromise<string | PageSource>
    unload?: () => void
    createDocument?: () => MaybePromise<Document>
    getText?: () => MaybePromise<string>
    linear?: string | null
    cfi?: string
    pageSpread?: string | null
    resolveHref?: (href: string) => string
    mediaOverlay?: { href: string } | null
}
export type Rendition = {
    layout?: string
    spread?: string
    orientation?: string
    flow?: string
    viewport?: string | { width?: string | number; height?: string | number }
}
export type MediaMetadata = {
    duration?: number
    activeClass?: string
    playbackActiveClass?: string
}
export type ResourceTransformDetail = {
    readonly name: string
    type: MaybePromise<string>
    data: MaybePromise<string | Blob>
}

export interface Book {
    sections: BookSection[]
    metadata?: BookMetadata
    toc?: TOCItem[] | null
    pageList?: TOCItem[] | null
    landmarks?: TOCItem[] | null
    rendition?: Rendition
    dir?: string | null
    transformTarget?: EventTarget
    media?: MediaMetadata
    getMediaOverlay?: () => MediaOverlay
    getCover?: () => MaybePromise<Blob | null | undefined>
    resolveHref?: (href: string) => MaybePromise<ResolvedNavigation | null | undefined>
    resolveCFI?: (cfi: string) => ResolvedNavigation
    splitTOCHref?: (href: string) => MaybePromise<[string | number, TOCFragment?] | [] | null>
    getTOCFragment?: (doc: Document, fragment: TOCFragment | undefined) => Node | null | undefined
    getSectionHref?: (index: number) => string | undefined
    isExternal?: (href: string) => boolean
    destroy?: () => MaybePromise<void>
}
