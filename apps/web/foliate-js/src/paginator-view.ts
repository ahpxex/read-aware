import type { Overlayer } from "./overlayer.js"
import { getDirection, getBackground, setStylesImportant } from "./paginator-geometry.js"


export type Layout = { width: number; height: number; margin: number; gap: number; columnWidth: number; flow?: string | null }

export type BeforeRender = { vertical: boolean; rtl: boolean; background?: string }


export class SectionView {
    readonly container: HTMLElement
    readonly onExpand: () => void

    #observer = new ResizeObserver(() => this.expand())
    #element = document.createElement('div')
    #iframe = document.createElement('iframe')
    #contentRange = document.createRange()
    #overlayer: Overlayer | undefined
    #vertical = false
    #rtl = false
    #column = true
    #size = 0
    #layout: Layout | undefined
    #destroyed = false
    #cancelLoad: (() => void) | undefined
    constructor({ container, onExpand }: { container: HTMLElement; onExpand: () => void }) {
        this.container = container
        this.onExpand = onExpand
        this.#iframe.setAttribute('part', 'filter')
        this.#element.append(this.#iframe)
        Object.assign(this.#element.style, {
            boxSizing: 'content-box',
            position: 'relative',
            overflow: 'hidden',
            flex: '0 0 auto',
            width: '100%', height: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
        })
        Object.assign(this.#iframe.style, {
            overflow: 'hidden',
            border: '0',
            display: 'none',
            width: '100%', height: '100%',
        })
        // `allow-scripts` is needed for events because of WebKit bug
        // https://bugs.webkit.org/show_bug.cgi?id=218086
        this.#iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
        this.#iframe.setAttribute('scrolling', 'no')
    }
    get element() {
        return this.#element
    }
    get document() {
        return this.#iframe.contentDocument
    }
    get ready() {
        return !this.#destroyed && this.#layout !== undefined
    }
    async load(src: string, afterLoad?: (doc: Document) => void, beforeRender?: (input: BeforeRender) => Layout) {
        if (typeof src !== 'string') throw new Error(`${src} is not string`)
        if (this.#destroyed) throw new DOMException('Page view was destroyed', 'AbortError')
        return new Promise<void>((resolve, reject) => {
            const cleanup = () => {
                this.#cancelLoad = undefined
                this.#iframe.removeEventListener('load', onLoad)
                this.#iframe.removeEventListener('error', onError)
            }
            const onError = () => { cleanup(); reject(new Error('Could not load page document')) }
            const onLoad = () => {
                try {
                    const doc = this.document
                    if (!doc) throw new Error('Page document is inaccessible')
                    afterLoad?.(doc)

                    // It must be visible for Firefox to compute page styles.
                    this.#iframe.style.display = 'block'
                    const { vertical, rtl } = getDirection(doc)
                    const background = getBackground(doc)
                    this.#iframe.style.display = 'none'
                    this.#vertical = vertical
                    this.#rtl = rtl
                    this.#contentRange.selectNodeContents(doc.body)
                    const layout = beforeRender?.({ vertical, rtl, background })
                    this.#iframe.style.display = 'block'
                    this.render(layout)
                    this.#observer.observe(doc.body)

                    // Firefox's iframe resize observer can miss font-driven changes.
                    doc.fonts.ready.then(() => this.expand())
                    resolve()
                } catch (error) { reject(error) }
                finally { cleanup() }
            }
            this.#cancelLoad = () => { cleanup(); reject(new DOMException('Page load was cancelled', 'AbortError')) }
            this.#iframe.addEventListener('load', onLoad, { once: true })
            this.#iframe.addEventListener('error', onError, { once: true })
            this.#iframe.src = src
        })
    }
    render(layout: Layout | undefined) {
        if (!layout) return
        // READAWARE: a view whose iframe has no document yet (still loading)
        // or no longer (torn down while the next book opens) has nothing to
        // lay out; the load path renders once the document exists.
        if (this.#destroyed || !this.document) return
        this.#column = layout.flow !== 'scrolled'
        this.#layout = layout
        if (this.#column) this.columnize(layout)
        else this.scrolled(layout)
    }
    scrolled({ gap, columnWidth }: Layout) {
        const vertical = this.#vertical
        const doc = this.document
        if (!doc) return
        setStylesImportant(doc.documentElement, {
            'box-sizing': 'border-box',
            'padding': vertical ? `${gap}px 0` : `0 ${gap}px`,
            'column-width': 'auto',
            'height': 'auto',
            'width': 'auto',
        })
        setStylesImportant(doc.body, {
            [vertical ? 'max-height' : 'max-width']: `${columnWidth}px`,
            'margin': 'auto',
        })
        this.setImageSize()
        this.expand()
    }
    columnize({ width, height, gap, columnWidth }: Layout) {
        const vertical = this.#vertical
        this.#size = vertical ? height : width

        const doc = this.document
        if (!doc) return
        setStylesImportant(doc.documentElement, {
            'box-sizing': 'border-box',
            'column-width': `${Math.trunc(columnWidth)}px`,
            'column-gap': `${gap}px`,
            'column-fill': 'auto',
            ...(vertical
                ? { 'width': `${width}px` }
                : { 'height': `${height}px` }),
            'padding': vertical ? `${gap / 2}px 0` : `0 ${gap / 2}px`,
            'overflow': 'hidden',
            // force wrap long words
            'overflow-wrap': 'break-word',
            // reset some potentially problematic props
            'position': 'static', 'border': '0', 'margin': '0',
            'max-height': 'none', 'max-width': 'none',
            'min-height': 'none', 'min-width': 'none',
            // fix glyph clipping in WebKit
            '-webkit-line-box-contain': 'block glyphs replaced',
        })
        setStylesImportant(doc.body, {
            'max-height': 'none',
            'max-width': 'none',
            'margin': '0',
        })
        this.setImageSize()
        this.expand()
    }
    setImageSize() {
        if (!this.#layout) return
        const { width, height, margin } = this.#layout
        const vertical = this.#vertical
        const doc = this.document
        if (!doc?.defaultView) return
        for (const el of doc.body.querySelectorAll<HTMLElement | SVGElement>('img, svg, video')) {
            // preserve max size if they are already set
            const { maxHeight, maxWidth } = doc.defaultView.getComputedStyle(el)
            setStylesImportant(el, {
                'max-height': vertical
                    ? (maxHeight !== 'none' && maxHeight !== '0px' ? maxHeight : '100%')
                    : `${height - margin * 2}px`,
                'max-width': vertical
                    ? `${width - margin * 2}px`
                    : (maxWidth !== 'none' && maxWidth !== '0px' ? maxWidth : '100%'),
                'object-fit': 'contain',
                'page-break-inside': 'avoid',
                'break-inside': 'avoid',
                'box-sizing': 'border-box',
            })
        }
    }
    expand() {
        // READAWARE: see render() — no document, nothing to measure.
        if (this.#destroyed || !this.document || !this.#layout) return
        const { documentElement } = this.document
        if (this.#column) {
            const side = this.#vertical ? 'height' : 'width'
            const otherSide = this.#vertical ? 'width' : 'height'
            const contentRect = this.#contentRange.getBoundingClientRect()
            const rootRect = documentElement.getBoundingClientRect()
            // offset caused by column break at the start of the page
            // which seem to be supported only by WebKit and only for horizontal writing
            const contentStart = this.#vertical ? 0
                : this.#rtl ? rootRect.right - contentRect.right : contentRect.left - rootRect.left
            const contentSize = contentStart + contentRect[side]
            const pageCount = Math.ceil(contentSize / this.#size)
            const expandedSize = pageCount * this.#size
            this.#element.style.padding = '0'
            this.#iframe.style[side] = `${expandedSize}px`
            this.#element.style[side] = `${expandedSize + this.#size * 2}px`
            this.#iframe.style[otherSide] = '100%'
            this.#element.style[otherSide] = '100%'
            documentElement.style[side] = `${this.#size}px`
            if (this.#overlayer) {
                this.#overlayer.element.style.margin = '0'
                this.#overlayer.element.style.left = this.#vertical ? '0' : `${this.#size}px`
                this.#overlayer.element.style.top = this.#vertical ? `${this.#size}px` : '0'
                this.#overlayer.element.style[side] = `${expandedSize}px`
                this.#overlayer.redraw()
            }
        } else {
            const side = this.#vertical ? 'width' : 'height'
            const otherSide = this.#vertical ? 'height' : 'width'
            const contentSize = documentElement.getBoundingClientRect()[side]
            const expandedSize = contentSize
            const { margin } = this.#layout
            const padding = this.#vertical ? `0 ${margin}px` : `${margin}px 0`
            this.#element.style.padding = padding
            this.#iframe.style[side] = `${expandedSize}px`
            this.#element.style[side] = `${expandedSize}px`
            this.#iframe.style[otherSide] = '100%'
            this.#element.style[otherSide] = '100%'
            if (this.#overlayer) {
                this.#overlayer.element.style.margin = padding
                this.#overlayer.element.style.left = '0'
                this.#overlayer.element.style.top = '0'
                this.#overlayer.element.style[side] = `${expandedSize}px`
                this.#overlayer.redraw()
            }
        }
        this.onExpand()
    }
    set overlayer(overlayer) {
        this.#overlayer = overlayer
        if (overlayer) this.#element.append(overlayer.element)
    }
    get overlayer() {
        return this.#overlayer
    }
    destroy() {
        this.#destroyed = true
        this.#cancelLoad?.()
        this.#observer.disconnect()
    }
}
