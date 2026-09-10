import type { ResolvedNavigation, TOCItem } from './book.js'
import type { PDFDocument, PDFOutline } from './vendor/pdfjs/pdf.mjs'

const isPageReference = (value: unknown): value is { num: number; gen: number } => value !== null
    && typeof value === 'object' && 'num' in value && 'gen' in value
    && typeof value.num === 'number' && Number.isInteger(value.num) && value.num >= 0
    && typeof value.gen === 'number' && Number.isInteger(value.gen) && value.gen >= 0

export const resolvePDFHref = async (
    pdf: Pick<PDFDocument, 'getDestination' | 'getPageIndex' | 'numPages'>,
    href: string,
): Promise<ResolvedNavigation | undefined> => {
    const parsed: unknown = JSON.parse(href)
    const destination: unknown = typeof parsed === 'string' ? await pdf.getDestination(parsed) : parsed
    if (!Array.isArray(destination)) return
    const ref: unknown = destination[0]
    const index = typeof ref === 'number' ? ref : isPageReference(ref) ? await pdf.getPageIndex(ref) : -1
    if (Number.isInteger(index) && index >= 0 && index < pdf.numPages) return { index }
}

export const makePDFTOCItem = (item: PDFOutline): TOCItem => ({
    label: item.title,
    href: item.url ?? JSON.stringify(item.dest),
    subitems: item.items.length ? item.items.map(makePDFTOCItem) : null,
})

/** Coalesce optional metadata reads without delaying PDF initialization or hiding failures. */
export const createPDFPageListLoader = (
    pdf: Pick<PDFDocument, 'numPages' | 'getPageLabels'>,
    isClosed: () => boolean,
): (() => Promise<TOCItem[] | null>) => {
    let pending: Promise<TOCItem[] | null> | undefined
    return () => {
        if (isClosed()) return Promise.reject(new Error('PDF document was closed'))
        pending ??= Promise.resolve().then(() => {
            if (isClosed()) throw new Error('PDF document was closed')
            return pdf.getPageLabels()
        }).then(labels => {
            if (isClosed()) throw new Error('PDF document was closed')
            if (labels === null) return null
            if (!Array.isArray(labels) || labels.length !== pdf.numPages || labels.some(label => typeof label !== 'string'))
                throw new Error('PDF page labels do not match the source pages')
            return labels.map((label, index) => ({ label, href: JSON.stringify([index, { name: 'Fit' }]) }))
        }).catch((error: unknown) => { pending = undefined; throw error })
        return pending
    }
}
