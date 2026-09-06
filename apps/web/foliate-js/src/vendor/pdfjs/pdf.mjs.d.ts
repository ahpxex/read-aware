import type { DocumentInitParameters, PDFPageProxy, TextContent } from 'pdfjs-dist/types/src/display/api.js'
import type { PageViewport } from 'pdfjs-dist'

// Runtime stays vendored. Reuse the pinned upstream geometry/render contracts,
// and narrow JSDoc-generated untyped data at the file-format boundary.
export type PDFDestination = [number | { num: number; gen: number }, ...unknown[]]
export type PDFOutline = { title: string; dest: string | PDFDestination | null; url?: string | null; items: PDFOutline[] }
export type PDFMetadata = { get(name: string): unknown }
export type PDFPage = Pick<PDFPageProxy, 'getViewport' | 'render'> & {
    streamTextContent(): ReadableStream<TextContent>
    getAnnotations(): Promise<Array<Record<string, unknown>>>
}
export type PDFDocument = {
    numPages: number
    getPage(index: number): Promise<PDFPage>
    getPageIndex(ref: { num: number; gen: number }): Promise<number>
    getDestination(name: string): Promise<PDFDestination | null>
    getOutline(): Promise<PDFOutline[] | null>
    getMetadata(): Promise<{ info: Record<string, unknown>; metadata: PDFMetadata | null }>
    destroy(): Promise<void>
}
export type LoadingTask = { promise: Promise<PDFDocument>; destroy(): Promise<void> }
export type LinkService = {
    goToDestination: (destination: string | PDFDestination) => void
    getDestinationHash: (destination: string | PDFDestination) => string
    addLinkAttributes: (link: HTMLAnchorElement, url: string) => void
}

export const GlobalWorkerOptions: typeof import('pdfjs-dist').GlobalWorkerOptions
export const PDFDataRangeTransport: typeof import('pdfjs-dist').PDFDataRangeTransport
export const version: string
export function getDocument(options: DocumentInitParameters): LoadingTask
export class TextLayer {
    constructor(options: { textContentSource: ReadableStream<TextContent>; container: HTMLElement; viewport: PageViewport })
    render(): Promise<void>
    cancel(): void
}
export class AnnotationLayer {
    constructor(options: { page: PDFPage; viewport: PageViewport; div: HTMLDivElement; linkService: LinkService })
    render(options: { annotations: Array<Record<string, unknown>> }): Promise<void>
}
