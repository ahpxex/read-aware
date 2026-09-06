import { SectionView, type Layout, type BeforeRender } from "./paginator-view.js"
import { uncollapse, getVisibleRange, selectionIsBackward, setSelectionTo, getBackground, makeMarginals, type RectMapper } from "./paginator-geometry.js"
import type { Anchor, Book, BookSection, MaybePromise, ResolvedNavigation, ResourceTransformDetail } from './book.js'

import type { Overlayer } from './overlayer.js'

import type { Content, LoadDetail, RelocateDetail, RelocateReason } from './renderer.js'


type Styles = string | [string, string] | null | undefined

type TouchState = { x: number; y: number; t: number; vx: number; vy: number; pinched?: boolean }

type DisplayTarget = ResolvedNavigation & { src?: string; release?: () => void; onLoad?: (detail: LoadDetail) => void }

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))


const debounce = <Args extends unknown[]>(f: (...args: Args) => void, wait: number, immediate = false) => {
    let timeout: ReturnType<typeof setTimeout> | null = null
    return (...args: Args) => {
        const later = () => {
            timeout = null
            if (!immediate) f(...args)
        }
        const callNow = immediate && !timeout
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(later, wait)
        if (callNow) f(...args)
    }
}


const lerp = (min: number, max: number, x: number) => x * (max - min) + min

const easeOutQuad = (x: number) => 1 - (1 - x) * (1 - x)

const animate = (a: number, b: number, duration: number, ease: (fraction: number) => number,
    render: (value: number) => void) => new Promise<void>(resolve => {
    let start: number | undefined
    const step = (now: number) => {
        if (document.hidden) {
            render(lerp(a, b, 1))
            return resolve()
        }
        start ??= now
        const fraction = Math.min(1, (now - start) / duration)
        render(lerp(a, b, ease(fraction)))
        if (fraction < 1) requestAnimationFrame(step)
        else resolve()
    }
    if (document.hidden) {
        render(lerp(a, b, 1))
        return resolve()
    }
    requestAnimationFrame(step)
})


// NOTE: everything here assumes the so-called "negative scroll type" for RTL
export class Paginator extends HTMLElement {
    bookDir: string | null | undefined
    sections: BookSection[] = []
    heads: Element[] | null = null
    feet: Element[] | null = null

    static observedAttributes = [
        'flow', 'gap', 'margin',
        'max-inline-size', 'max-block-size', 'max-column-count',
    ]
    #root = this.attachShadow({ mode: 'closed' })
    #observer = new ResizeObserver(() => this.render())
    #top: HTMLElement
    #background: HTMLElement
    #container: HTMLElement
    #header: HTMLElement
    #footer: HTMLElement
    #view: SectionView | null = null
    #releaseSection: (() => void) | undefined
    #vertical = false
    #rtl = false
    #margin = 0
    #index = -1
    #anchor: Anchor = 0 // anchor view to a fraction (0-1), Range, or Element
    #justAnchored = false
    #locked = false // while true, prevent any further navigation
    #styles: Styles
    #styleMap = new WeakMap<Document, [HTMLStyleElement, HTMLStyleElement]>()
    #mediaQuery = matchMedia('(prefers-color-scheme: dark)')
    #mediaQueryListener
    #scrollBounds: [number, number, number] = [0, 0, 0]
    #touchState: TouchState | null = null
    #touchScrolled = false
    #lastVisibleRange: Range | null = null
    #navigation = 0
    constructor() {
        super()
        this.#root.innerHTML = `<style>
        :host {
            display: block;
            container-type: size;
        }
        :host, #top {
            box-sizing: border-box;
            position: relative;
            overflow: hidden;
            width: 100%;
            height: 100%;
        }
        #top {
            --_gap: 7%;
            --_margin: 48px;
            --_max-inline-size: 720px;
            --_max-block-size: 1440px;
            --_max-column-count: 2;
            --_max-column-count-portrait: 1;
            --_max-column-count-spread: var(--_max-column-count);
            --_half-gap: calc(var(--_gap) / 2);
            --_max-width: calc(var(--_max-inline-size) * var(--_max-column-count-spread));
            --_max-height: var(--_max-block-size);
            display: grid;
            grid-template-columns:
                minmax(var(--_half-gap), 1fr)
                var(--_half-gap)
                minmax(0, calc(var(--_max-width) - var(--_gap)))
                var(--_half-gap)
                minmax(var(--_half-gap), 1fr);
            grid-template-rows:
                minmax(var(--_margin), 1fr)
                minmax(0, var(--_max-height))
                minmax(var(--_margin), 1fr);
            &.vertical {
                --_max-column-count-spread: var(--_max-column-count-portrait);
                --_max-width: var(--_max-block-size);
                --_max-height: calc(var(--_max-inline-size) * var(--_max-column-count-spread));
            }
            @container (orientation: portrait) {
                & {
                    --_max-column-count-spread: var(--_max-column-count-portrait);
                }
                &.vertical {
                    --_max-column-count-spread: var(--_max-column-count);
                }
            }
        }
        #background {
            grid-column: 1 / -1;
            grid-row: 1 / -1;
        }
        #container {
            grid-column: 2 / 5;
            grid-row: 2;
            overflow: hidden;
        }
        :host([flow="scrolled"]) #container {
            grid-column: 1 / -1;
            grid-row: 1 / -1;
            overflow: auto;
        }
        /* ReadAware patch: the scroll-mode scroller lives in this closed shadow
           root, out of reach of the app's global scrollbar CSS — so mirror that
           hairline scrollbar here (see apps/web/src/index.css). Custom properties
           inherit across the shadow boundary, so the app tokens (and their dark
           theme override) resolve; the fallbacks cover foliate running alone.
           Note: we deliberately do NOT set scrollbar-width — a non-auto value
           disables ::-webkit-scrollbar in WebKit/Chromium and brings the native
           track + hover-thickening back. */
        #container::-webkit-scrollbar {
            width: var(--ra-scrollbar-size, 3px);
            height: var(--ra-scrollbar-size, 3px);
        }
        #container::-webkit-scrollbar-track,
        #container::-webkit-scrollbar-corner {
            background: transparent;
            border: 0;
        }
        #container::-webkit-scrollbar-thumb {
            background-color: var(--ra-scrollbar-color, rgb(28 25 23 / 0.42));
            border: 0;
            border-radius: 9999px;
        }
        #header {
            grid-column: 3 / 4;
            grid-row: 1;
        }
        #footer {
            grid-column: 3 / 4;
            grid-row: 3;
            align-self: end;
        }
        #header, #footer {
            display: grid;
            height: var(--_margin);
        }
        :is(#header, #footer) > * {
            display: flex;
            align-items: center;
            min-width: 0;
        }
        :is(#header, #footer) > * > * {
            width: 100%;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            text-align: center;
            font-size: .75em;
            opacity: .6;
        }
        </style>
        <div id="top">
            <div id="background" part="filter"></div>
            <div id="header"></div>
            <div id="container"></div>
            <div id="footer"></div>
        </div>
        `

        const templateElement = (id: string): HTMLElement => {
            const element = this.#root.getElementById(id)
            if (!element) throw new Error(`Missing paginator template element: ${id}`)
            return element
        }
        this.#top = templateElement('top')
        this.#background = templateElement('background')
        this.#container = templateElement('container')
        this.#header = templateElement('header')
        this.#footer = templateElement('footer')

        this.#observer.observe(this.#container)
        this.#container.addEventListener('scroll', () => this.dispatchEvent(new Event('scroll')))
        this.#container.addEventListener('scroll', debounce(() => {
            if (this.scrolled) {
                if (this.#justAnchored) this.#justAnchored = false
                else this.#afterScroll('scroll')
            }
        }, 250))

        const opts = { passive: false }
        this.addEventListener('touchstart', this.#onTouchStart.bind(this), opts)
        this.addEventListener('touchmove', this.#onTouchMove.bind(this), opts)
        this.addEventListener('touchend', this.#onTouchEnd.bind(this))
        this.addEventListener('load', event => {
            const { doc } = (event as CustomEvent<LoadDetail>).detail
            doc.addEventListener('touchstart', this.#onTouchStart.bind(this), opts)
            doc.addEventListener('touchmove', this.#onTouchMove.bind(this), opts)
            doc.addEventListener('touchend', this.#onTouchEnd.bind(this))
        })

        this.addEventListener('relocate', event => {
            const { detail } = event as CustomEvent<RelocateDetail>
            if (detail.reason === 'selection') setSelectionTo(this.#anchor, 0)
            else if (detail.reason === 'navigation') {
                if (this.#anchor === 1) setSelectionTo(detail.range, 1)
                else if (typeof this.#anchor === 'number')
                    setSelectionTo(detail.range, -1)
                else setSelectionTo(this.#anchor, -1)
            }
        })
        const checkPointerSelection = debounce((range: Range, sel: Selection) => {
            if (!sel.rangeCount) return
            const selRange = sel.getRangeAt(0)
            const backward = selectionIsBackward(sel)
            if (backward && selRange.compareBoundaryPoints(Range.START_TO_START, range) < 0)
                this.prev()
            else if (!backward && selRange.compareBoundaryPoints(Range.END_TO_END, range) > 0)
                this.next()
        }, 700)
        this.addEventListener('load', event => {
            const { doc } = (event as CustomEvent<LoadDetail>).detail
            let isPointerSelecting = false
            doc.addEventListener('pointerdown', () => isPointerSelecting = true)
            doc.addEventListener('pointerup', () => isPointerSelecting = false)
            let isKeyboardSelecting = false
            doc.addEventListener('keydown', () => isKeyboardSelecting = true)
            doc.addEventListener('keyup', () => isKeyboardSelecting = false)
            doc.addEventListener('selectionchange', () => {
                if (this.scrolled) return
                const range = this.#lastVisibleRange
                if (!range) return
                const sel = doc.getSelection()
                if (!sel?.rangeCount) return
                if (isPointerSelecting && sel.type === 'Range')
                    checkPointerSelection(range, sel)
                else if (isKeyboardSelecting) {
                    const selRange = sel.getRangeAt(0).cloneRange()
                    const backward = selectionIsBackward(sel)
                    if (!backward) selRange.collapse()
                    this.#scrollToAnchor(selRange)
                }
            })
            doc.addEventListener('focusin', e => {
                const target = e.target
                if (this.scrolled || !target || !('nodeType' in target) || target.nodeType !== 1) return
                // NOTE: `requestAnimationFrame` is needed in WebKit
                requestAnimationFrame(() => this.#scrollToAnchor(target as Element))
            })
        })

        this.#mediaQueryListener = () => {
            if (!this.#view?.document) return
            this.#background.style.background = getBackground(this.#view.document)
        }
        this.#mediaQuery.addEventListener('change', this.#mediaQueryListener)
    }
    attributeChangedCallback(name: string, _: string | null, value: string | null) {
        switch (name) {
            case 'flow':
                this.render()
                break
            case 'gap':
            case 'margin':
            case 'max-block-size':
            case 'max-column-count':
                this.#top.style.setProperty('--_' + name, value)
                break
            case 'max-inline-size':
                // needs explicit `render()` as it doesn't necessarily resize
                this.#top.style.setProperty('--_' + name, value)
                this.render()
                break
        }
    }
    #transformController: AbortController | undefined
    open(book: Book) {
        this.#transformController?.abort()
        this.#transformController = new AbortController()
        this.bookDir = book.dir
        this.sections = book.sections
        book.transformTarget?.addEventListener('data', event => {
            const { detail } = event as CustomEvent<ResourceTransformDetail>
            if (detail.type !== 'text/css') return
            const w = innerWidth
            const h = innerHeight
            detail.data = Promise.resolve(detail.data).then(data => typeof data !== 'string' ? data : data
                // unprefix as most of the props are (only) supported unprefixed
                .replace(/(?<=[{\s;])-epub-/gi, '')
                // replace vw and vh as they cause problems with layout
                .replace(/(\d*\.?\d+)vw/gi, (_, d) => parseFloat(d) * w / 100 + 'px')
                .replace(/(\d*\.?\d+)vh/gi, (_, d) => parseFloat(d) * h / 100 + 'px')
                // `page-break-*` unsupported in columns; replace with `column-break-*`
                .replace(/page-break-(after|before|inside)\s*:/gi, (_, x) =>
                    `-webkit-column-break-${x}:`)
                .replace(/break-(after|before|inside)\s*:\s*(avoid-)?page/gi, (_, x, y) =>
                    `break-${x}: ${y ?? ''}column`))
        }, { signal: this.#transformController.signal })
    }
    #createView() {
        if (this.#view) {
            this.#view.destroy()
            this.#container.removeChild(this.#view.element)
        }
        this.#view = new SectionView({
            container: this,
            onExpand: () => this.#scrollToAnchor(this.#anchor),
        })
        this.#container.append(this.#view.element)
        return this.#view
    }
    #beforeRender({ vertical, rtl, background }: BeforeRender): Layout {
        this.#vertical = vertical
        this.#rtl = rtl
        this.#top.classList.toggle('vertical', vertical)

        // set background to `doc` background
        // this is needed because the iframe does not fill the whole element
        if (background !== undefined) this.#background.style.background = background

        const { width, height } = this.#container.getBoundingClientRect()
        const size = vertical ? height : width

        const style = getComputedStyle(this.#top)
        const maxInlineSize = parseFloat(style.getPropertyValue('--_max-inline-size'))
        const maxColumnCount = parseInt(style.getPropertyValue('--_max-column-count-spread'))
        const margin = parseFloat(style.getPropertyValue('--_margin'))
        this.#margin = margin

        const g = parseFloat(style.getPropertyValue('--_gap')) / 100
        // The gap will be a percentage of the #container, not the whole view.
        // This means the outer padding will be bigger than the column gap. Let
        // `a` be the gap percentage. The actual percentage for the column gap
        // will be (1 - a) * a. Let us call this `b`.
        //
        // To make them the same, we start by shrinking the outer padding
        // setting to `b`, but keep the column gap setting the same at `a`. Then
        // the actual size for the column gap will be (1 - b) * a. Repeating the
        // process again and again, we get the sequence
        //     x₁ = (1 - b) * a
        //     x₂ = (1 - x₁) * a
        //     ...
        // which converges to x = (1 - x) * a. Solving for x, x = a / (1 + a).
        // So to make the spacing even, we must shrink the outer padding with
        //     f(x) = x / (1 + x).
        // But we want to keep the outer padding, and make the inner gap bigger.
        // So we apply the inverse, f⁻¹ = -x / (x - 1) to the column gap.
        const gap = -g / (g - 1) * size

        const flow = this.getAttribute('flow')
        if (flow === 'scrolled') {
            // FIXME: vertical-rl only, not -lr
            this.setAttribute('dir', vertical ? 'rtl' : 'ltr')
            this.#top.style.padding = '0'
            const columnWidth = maxInlineSize

            this.heads = null
            this.feet = null
            this.#header.replaceChildren()
            this.#footer.replaceChildren()

            return { flow, height, width, margin, gap, columnWidth }
        }

        const divisor = Math.min(maxColumnCount, Math.ceil(size / maxInlineSize))
        const columnWidth = (size / divisor) - gap
        this.setAttribute('dir', rtl ? 'rtl' : 'ltr')

        const marginalDivisor = vertical
            ? Math.min(2, Math.ceil(width / maxInlineSize))
            : divisor
        const marginalStyle = {
            gridTemplateColumns: `repeat(${marginalDivisor}, 1fr)`,
            gap: `${gap}px`,
            direction: this.bookDir === 'rtl' ? 'rtl' : 'ltr',
        }
        Object.assign(this.#header.style, marginalStyle)
        Object.assign(this.#footer.style, marginalStyle)
        const heads = makeMarginals(marginalDivisor, 'head')
        const feet = makeMarginals(marginalDivisor, 'foot')
        this.heads = heads.map(el => el.children[0])
        this.feet = feet.map(el => el.children[0])
        this.#header.replaceChildren(...heads)
        this.#footer.replaceChildren(...feet)

        return { height, width, margin, gap, columnWidth }
    }
    render() {
        if (!this.#view) return
        this.#view.render(this.#beforeRender({
            vertical: this.#vertical,
            rtl: this.#rtl,
        }))
        this.#scrollToAnchor(this.#anchor)
    }
    get scrolled() {
        return this.getAttribute('flow') === 'scrolled'
    }
    get scrollProp() {
        const { scrolled } = this
        return this.#vertical ? (scrolled ? 'scrollLeft' : 'scrollTop')
            : scrolled ? 'scrollTop' : 'scrollLeft'
    }
    get sideProp() {
        const { scrolled } = this
        return this.#vertical ? (scrolled ? 'width' : 'height')
            : scrolled ? 'height' : 'width'
    }
    get size() {
        return this.#container.getBoundingClientRect()[this.sideProp]
    }
    get viewSize() {
        return this.#view?.element.getBoundingClientRect()[this.sideProp] ?? 0
    }
    get start() {
        return Math.abs(this.#container[this.scrollProp])
    }
    get end() {
        return this.start + this.size
    }
    get page() {
        return Math.floor(((this.start + this.end) / 2) / this.size)
    }
    get pages() {
        return Math.round(this.viewSize / this.size)
    }
    scrollBy(options?: ScrollToOptions): void
    scrollBy(x: number, y: number): void
    scrollBy(dxOrOptions: number | ScrollToOptions = 0, dy = 0) {
        const dx = typeof dxOrOptions === 'number' ? dxOrOptions : dxOrOptions.left ?? 0
        if (typeof dxOrOptions !== 'number') dy = dxOrOptions.top ?? 0
        const delta = this.#vertical ? dy : dx
        const element = this.#container
        const { scrollProp } = this
        const [offset, a, b] = this.#scrollBounds
        const rtl = this.#rtl
        const min = rtl ? offset - b : offset - a
        const max = rtl ? offset + a : offset + b
        element[scrollProp] = Math.max(min, Math.min(max,
            element[scrollProp] + delta))
    }
    snap(vx: number, vy: number) {
        const velocity = this.#vertical ? vy : vx
        const [offset, a, b] = this.#scrollBounds
        const { start, end, pages, size } = this
        const min = Math.abs(offset) - a
        const max = Math.abs(offset) + b
        const d = velocity * (this.#rtl ? -size : size)
        const page = Math.floor(
            Math.max(min, Math.min(max, (start + end) / 2
                + (isNaN(d) ? 0 : d))) / size)

        this.#scrollToPage(page, 'snap').then(() => {
            const dir = page <= 0 ? -1 : page >= pages - 1 ? 1 : null
            const index = dir && this.#adjacentIndex(dir)
            if (dir && index != null) return this.#goTo({
                index,
                anchor: dir < 0 ? () => 1 : () => 0,
            })
        })
    }
    #onTouchStart(e: TouchEvent) {
        const touch = e.changedTouches[0]
        if (!touch) return
        this.#touchState = {
            x: touch?.screenX, y: touch?.screenY,
            t: e.timeStamp,
            vx: 0, vy: 0,
        }
    }
    #onTouchMove(e: TouchEvent) {
        const state = this.#touchState
        if (!state || state.pinched) return
        state.pinched = (globalThis.visualViewport?.scale ?? 1) > 1
        if (this.scrolled || state.pinched) return
        if (e.touches.length > 1) {
            if (this.#touchScrolled) e.preventDefault()
            return
        }
        e.preventDefault()
        const touch = e.changedTouches[0]
        if (!touch) return
        const x = touch.screenX, y = touch.screenY
        const dx = state.x - x, dy = state.y - y
        const dt = e.timeStamp - state.t
        state.x = x
        state.y = y
        state.t = e.timeStamp
        state.vx = dx / dt
        state.vy = dy / dt
        this.#touchScrolled = true
        this.scrollBy(dx, dy)
    }
    #onTouchEnd() {
        this.#touchScrolled = false
        if (this.scrolled) return

        // XXX: Firefox seems to report scale as 1... sometimes...?
        // at this point I'm basically throwing `requestAnimationFrame` at
        // anything that doesn't work
        requestAnimationFrame(() => {
            if ((globalThis.visualViewport?.scale ?? 1) === 1 && this.#touchState)
                this.snap(this.#touchState.vx, this.#touchState.vy)
        })
    }
    // allows one to process rects as if they were LTR and horizontal
    #getRectMapper(): RectMapper {
        if (this.scrolled) {
            const size = this.viewSize
            const margin = this.#margin
            return this.#vertical
                ? ({ left, right }) =>
                    ({ left: size - right - margin, right: size - left - margin })
                : ({ top, bottom }) => ({ left: top + margin, right: bottom + margin })
        }
        const pxSize = this.pages * this.size
        return this.#rtl
            ? ({ left, right }) =>
                ({ left: pxSize - right, right: pxSize - left })
            : this.#vertical
                ? ({ top, bottom }) => ({ left: top, right: bottom })
                : f => f
    }
    async #scrollToRect(rect: DOMRect, reason: RelocateReason | null) {
        if (this.scrolled) {
            const offset = this.#getRectMapper()(rect).left - this.#margin
            return this.#scrollTo(offset, reason)
        }
        const offset = this.#getRectMapper()(rect).left
        return this.#scrollToPage(Math.floor(offset / this.size) + (this.#rtl ? -1 : 1), reason)
    }
    async #scrollTo(offset: number, reason: RelocateReason | null, smooth = false) {
        const element = this.#container
        const { scrollProp, size } = this
        if (element[scrollProp] === offset) {
            this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size]
            this.#afterScroll(reason)
            return
        }
        // FIXME: vertical-rl only, not -lr
        if (this.scrolled && this.#vertical) offset = -offset
        if ((reason === 'snap' || smooth) && this.hasAttribute('animated')) return animate(
            element[scrollProp], offset, 300, easeOutQuad,
            x => element[scrollProp] = x,
        ).then(() => {
            this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size]
            this.#afterScroll(reason)
        })
        else {
            element[scrollProp] = offset
            this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size]
            this.#afterScroll(reason)
        }
    }
    async #scrollToPage(page: number, reason: RelocateReason | null, smooth = false) {
        const offset = this.size * (this.#rtl ? -page : page)
        return this.#scrollTo(offset, reason, smooth)
    }
    async scrollToAnchor(anchor: Anchor, select?: boolean) {
        return this.#scrollToAnchor(anchor, select ? 'selection' : 'navigation')
    }
    async #scrollToAnchor(anchor: Anchor, reason: RelocateReason = 'anchor') {
        this.#anchor = anchor
        const rects = typeof anchor !== 'number' ? uncollapse(anchor)?.getClientRects() : undefined
        // if anchor is an element or a range
        if (rects) {
            // when the start of the range is immediately after a hyphen in the
            // previous column, there is an extra zero width rect in that column
            const rect = Array.from(rects)
                .find(r => r.width > 0 && r.height > 0) || rects[0]
            if (!rect) return
            await this.#scrollToRect(rect, reason)
            return
        }
        // if anchor is a fraction
        if (typeof anchor !== 'number') return
        if (this.scrolled) {
            await this.#scrollTo(anchor * this.viewSize, reason)
            return
        }
        const { pages } = this
        if (!pages) return
        const textPages = pages - 2
        const newPage = Math.round(anchor * (textPages - 1))
        await this.#scrollToPage(newPage + 1, reason)
    }
    #getVisibleRange() {
        const doc = this.#view?.document
        if (!doc) return null
        if (this.scrolled) return getVisibleRange(doc,
            this.start + this.#margin, this.end - this.#margin, this.#getRectMapper())
        const size = this.#rtl ? -this.size : this.size
        return getVisibleRange(doc,
            this.start - size, this.end - size, this.#getRectMapper())
    }
    #afterScroll(reason: RelocateReason | null) {
        const range = this.#getVisibleRange()
        if (!range) return
        this.#lastVisibleRange = range
        // don't set new anchor if relocation was to scroll to anchor
        if (reason !== 'selection' && reason !== 'navigation' && reason !== 'anchor')
            this.#anchor = range
        else this.#justAnchored = true

        const index = this.#index
        const detail: RelocateDetail = { reason, range, index }
        if (this.scrolled) detail.fraction = this.start / this.viewSize
        else if (this.pages > 0) {
            const { page, pages } = this
            this.#header.style.visibility = page > 1 ? 'visible' : 'hidden'
            detail.fraction = (page - 1) / (pages - 2)
            detail.size = 1 / (pages - 2)
        }
        this.dispatchEvent(new CustomEvent('relocate', { detail }))
    }
    async #display(promise: MaybePromise<DisplayTarget>, navigation: number) {
        const { index, src, anchor, onLoad, select, release } = await promise
        if (navigation !== this.#navigation) { release?.(); return }
        this.#index = index
        const hasFocus = this.#view?.document?.hasFocus()
        if (src) {
            const view = this.#createView()
            this.#releaseSection?.()
            this.#releaseSection = release
            const afterLoad = (doc: Document) => {
                if (navigation !== this.#navigation) return
                if (doc.head) {
                    const $styleBefore = doc.createElement('style')
                    doc.head.prepend($styleBefore)
                    const $style = doc.createElement('style')
                    doc.head.append($style)
                    this.#styleMap.set(doc, [$styleBefore, $style])
                }
                onLoad?.({ doc, index })
            }
            const beforeRender = this.#beforeRender.bind(this)
            try { await view.load(src, afterLoad, beforeRender) }
            catch (error) {
                if (this.#view === view) {
                    view.destroy()
                    view.element.remove()
                    this.#view = null
                    this.#releaseSection?.()
                    this.#releaseSection = undefined
                }
                // A superseding navigation or close deliberately cancels this view.
                if (navigation !== this.#navigation) return
                throw error
            }
            if (navigation !== this.#navigation) return
            this.dispatchEvent(new CustomEvent('create-overlayer', {
                detail: {
                    doc: view.document, index,
                    attach: (overlayer: Overlayer) => view.overlayer = overlayer,
                },
            }))
            this.#view = view
        }
        const doc = this.#view?.document
        if (!doc) return
        await this.scrollToAnchor((typeof anchor === 'function'
            ? anchor(doc) : anchor) ?? 0, select)
        if (hasFocus) this.focusView()
    }
    #canGoToIndex(index: number): boolean {
        return Number.isInteger(index) && index >= 0 && index <= this.sections.length - 1
    }
    async #goTo({ index, anchor, select }: ResolvedNavigation, navigation = ++this.#navigation) {
        if (!this.#canGoToIndex(index)) return
        if (index === this.#index && this.#view?.ready) await this.#display({ index, anchor, select }, navigation)
        else {
            const onLoad = (detail: LoadDetail) => {
                this.setStyles(this.#styles)
                this.dispatchEvent(new CustomEvent('load', { detail }))
            }
            const section = this.sections[index]
            await this.#display(Promise.resolve(section.load())
                .then(src => {
                    if (typeof src !== 'string') {
                        section.unload?.()
                        throw new Error('Reflowable section must load a document URL')
                    }
                    let released = false
                    const release = () => {
                        if (!released) { released = true; section.unload?.() }
                    }
                    return { index, src, anchor, onLoad, select, release }
                }), navigation)
        }
    }
    async goTo(target: MaybePromise<ResolvedNavigation | null | undefined>) {
        if (this.#locked) return
        const navigation = ++this.#navigation
        const resolved = await target
        if (navigation === this.#navigation && resolved && this.#canGoToIndex(resolved.index))
            return this.#goTo(resolved, navigation)
    }
    #scrollPrev(distance?: number) {
        if (!this.#view) return true
        if (this.scrolled) {
            if (this.start > 0) return this.#scrollTo(
                Math.max(0, this.start - (distance ?? this.size)), null, true)
            return true
        }
        if (this.atStart) return
        const page = this.page - 1
        return this.#scrollToPage(page, 'page', true).then(() => page <= 0)
    }
    #scrollNext(distance?: number) {
        if (!this.#view) return true
        if (this.scrolled) {
            if (this.viewSize - this.end > 2) return this.#scrollTo(
                Math.min(this.viewSize, distance ? this.start + distance : this.end), null, true)
            return true
        }
        if (this.atEnd) return
        const page = this.page + 1
        const pages = this.pages
        return this.#scrollToPage(page, 'page', true).then(() => page >= pages - 1)
    }
    get atStart() {
        return this.#adjacentIndex(-1) == null && this.page <= 1
    }
    get atEnd() {
        return this.#adjacentIndex(1) == null && this.page >= this.pages - 2
    }
    #adjacentIndex(dir: -1 | 1): number | undefined {
        for (let index = this.#index + dir; this.#canGoToIndex(index); index += dir)
            if (this.sections[index]?.linear !== 'no') return index
    }
    async #turnPage(dir: -1 | 1, distance?: number) {
        if (this.#locked) return
        this.#locked = true
        try {
        const prev = dir === -1
        const shouldGo = await (prev ? this.#scrollPrev(distance) : this.#scrollNext(distance))
        const index = shouldGo ? this.#adjacentIndex(dir) : undefined
        if (index !== undefined) await this.#goTo({
            index,
            anchor: prev ? () => 1 : () => 0,
        })
        if (shouldGo || !this.hasAttribute('animated')) await wait(100)
        } finally { this.#locked = false }
    }
    prev(distance?: number) {
        return this.#turnPage(-1, distance)
    }
    next(distance?: number) {
        return this.#turnPage(1, distance)
    }
    prevSection() {
        const index = this.#adjacentIndex(-1)
        return this.goTo(index === undefined ? undefined : { index })
    }
    nextSection() {
        const index = this.#adjacentIndex(1)
        return this.goTo(index === undefined ? undefined : { index })
    }
    firstSection() {
        const index = this.sections.findIndex(section => section.linear !== 'no')
        return this.goTo({ index })
    }
    lastSection() {
        const index = this.sections.findLastIndex(section => section.linear !== 'no')
        return this.goTo({ index })
    }
    getContents(): Content[] {
        if (this.#view?.document) return [{
            index: this.#index,
            overlayer: this.#view.overlayer,
            doc: this.#view.document,
        }]
        return []
    }
    setStyles(styles: Styles) {
        this.#styles = styles
        const doc = this.#view?.document
        if (!doc) return
        const $$styles = this.#styleMap.get(doc)
        if (!$$styles) return
        const [$beforeStyle, $style] = $$styles
        if (Array.isArray(styles)) {
            const [beforeStyle, style] = styles
            $beforeStyle.textContent = beforeStyle
            $style.textContent = style
        } else $style.textContent = styles ?? ''

        // NOTE: needs `requestAnimationFrame` in Chromium
        requestAnimationFrame(() => {
            if (this.#view?.document === doc) this.#background.style.background = getBackground(doc)
        })

        // needed because the resize observer doesn't work in Firefox
        doc.fonts?.ready.then(() => this.#view?.expand())
    }
    focusView() {
        this.#view?.document?.defaultView?.focus()
    }
    destroy() {
        this.#navigation++
        this.#transformController?.abort()
        this.#observer.disconnect()
        this.#view?.destroy()
        this.#view?.element.remove()
        this.#view = null
        this.#releaseSection?.()
        this.#releaseSection = undefined
        this.#mediaQuery.removeEventListener('change', this.#mediaQueryListener)
    }
}


customElements.define('foliate-paginator', Paginator)
