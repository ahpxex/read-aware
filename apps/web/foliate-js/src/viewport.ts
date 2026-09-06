import type { Rendition } from './book.js'

export type Dimensions = { width: number; height: number }

const dimensions = (width: string | number | undefined, height: string | number | undefined): Dimensions | undefined => {
    const w = Number(width), h = Number(height)
    if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) return { width: w, height: h }
}

export const parseViewport = (value: Rendition['viewport'] | null): Dimensions | undefined => {
    if (!value) return
    if (typeof value !== 'string') return dimensions(value.width, value.height)
    const parts = Object.fromEntries(value.split(/[,;\s]/).filter(Boolean)
        .map(part => part.split('=').map(value => value.trim())))
    return dimensions(parts.width, parts.height)
}

export const getViewport = (doc: Document, viewport?: Rendition['viewport']): Dimensions => {
    if (doc.documentElement.localName === 'svg') {
        const [, , width, height] = doc.documentElement.getAttribute('viewBox')?.trim().split(/[\s,]+/) ?? []
        const result = dimensions(width, height)
        if (result) return result
    }
    const meta = parseViewport(doc.querySelector('meta[name="viewport"]')?.getAttribute('content'))
    if (meta) return meta
    const fallback = parseViewport(viewport)
    if (fallback) return fallback
    const img = doc.querySelector('img')
    const image = img && dimensions(img.naturalWidth, img.naturalHeight)
    if (image) return image
    console.warn(new Error('Missing viewport properties'))
    return { width: 1000, height: 2000 }
}
