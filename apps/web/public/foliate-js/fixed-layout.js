const parseViewport = str => str
    ?.split(/[,;\s]/) // NOTE: technically, only the comma is valid
    ?.filter(x => x)
    ?.map(x => x.split('=').map(x => x.trim()))

const getViewport = (doc, viewport) => {
    // use `viewBox` for SVG
    if (doc.documentElement.localName === 'svg') {
        const [, , width, height] = doc.documentElement
            .getAttribute('viewBox')?.split(/\s/) ?? []
        return { width, height }
    }

    // get `viewport` `meta` element
    const meta = parseViewport(doc.querySelector('meta[name="viewport"]')
        ?.getAttribute('content'))
    if (meta) return Object.fromEntries(meta)

    // fallback to book's viewport
    if (typeof viewport === 'string') return parseViewport(viewport)
    if (viewport?.width && viewport.height) return viewport

    // if no viewport (possibly with image directly in spine), get image size
    const img = doc.querySelector('img')
    if (img) return { width: img.naturalWidth, height: img.naturalHeight }

    // just show *something*, i guess...
    console.warn(new Error('Missing viewport properties'))
    return { width: 1000, height: 2000 }
}

// READAWARE: rendering budgets, canvas-memory driven. A PDF page rastered at
// fit-width on a Retina display runs ~12–17 MB of RGBA; a dozen live pages
// ≈ 150–200 MB, which WKWebView tolerates — rastering a whole 200-page scan
// would not be. Documents at or under FULL_RENDER_MAX_SPREADS keep every page
// alive once rendered; larger ones keep a window around the reading position.
const FULL_RENDER_MAX_SPREADS = 12

// Paged flows: spreads prerendered around the current one, and the LRU cap on
// live cached spreads beyond which the farthest are dropped.
const PRELOAD_SPREADS_AHEAD = 2
const PRELOAD_SPREADS_BEHIND = 1
const CACHE_MAX_SPREADS = 10

// Scrolled flow (a continuous stack of pages): how far beyond the viewport
// pages are kept rendered, in viewport heights. Promotion is what gets built
// as the reader approaches; demotion is where a live page is torn back down
// to its placeholder — wider, so scrolling back and forth doesn't churn.
const STACK_AHEAD_VIEWPORTS = 2.5
const STACK_BEHIND_VIEWPORTS = 1.5
const STACK_KEEP_AHEAD_VIEWPORTS = 5
const STACK_KEEP_BEHIND_VIEWPORTS = 3

export class FixedLayout extends HTMLElement {
    static observedAttributes = ['zoom', 'flow', 'max-column-count']
    #root = this.attachShadow({ mode: 'closed' })
    #observer = new ResizeObserver(() => this.#onResize())
    #spreads
    #index = -1
    defaultViewport
    spread
    #portrait = false
    #left
    #right
    #center
    #side
    #zoom
    #flow
    #maxColumnCount
    // READAWARE: `{ background, foreground? }`, or null to render as authored.
    // Page colors are baked in at render time rather than filtered afterwards,
    // so changing them has to redraw every live frame — see setPageColors.
    #pageColors = null
    // READAWARE: paged-flow spread cache. `#framePromises` holds in-flight and
    // settled creations (a preload and a navigation racing on the same spread
    // share one set of iframes); `#liveFrames` holds settled ones — what
    // rendering, page colors, and eviction iterate. `#lru` orders spread
    // indexes by recency for eviction.
    #framePromises = new Map()
    #liveFrames = new Map()
    #lru = []
    #preloadToken = 0
    // READAWARE: scrolled-flow page stack. One sized slot per spread keeps the
    // scrollbar honest for the whole document; a slot holds a live frame only
    // while the reader is near it. `#stack` entries:
    // { slot, frame, framePromise, width, height, sized }.
    #stack = null
    #stackCurrent = 0
    #stackLive = new Set()
    #stackWanted = new Set()
    #stackDraining = false
    #stackScrollTimer = 0
    #stackReportTimer = 0
    #stackDefaultDims = null
    // READAWARE: trailing setTimeout throttle, deliberately not rAF — WKWebView
    // suspends animation frames entirely while the window is occluded, and the
    // window logic must not silently die with them.
    #onStackScroll = () => {
        if (!this.#stack || this.#stackScrollTimer) return
        this.#stackScrollTimer = setTimeout(() => {
            this.#stackScrollTimer = 0
            this.#updateStackWindow('scroll')
        }, 32)
    }
    constructor() {
        super()

        const sheet = new CSSStyleSheet()
        this.#root.adoptedStyleSheets = [sheet]
        sheet.replaceSync(`:host {
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
            overflow: auto;
        }
        :host([flow="scrolled"]) {
            flex-direction: column;
            justify-content: flex-start;
            align-items: center;
            overscroll-behavior: contain;
        }`)

        this.#observer.observe(this)
        this.addEventListener('scroll', this.#onStackScroll, { passive: true })
    }
    attributeChangedCallback(name, _, value) {
        switch (name) {
            case 'zoom':
                this.#zoom = value !== 'fit-width' && value !== 'fit-page'
                    ? parseFloat(value) : value
                this.#onResize()
                break
            case 'flow':
                if (value === this.#flow) break
                this.#flow = value
                this.#rebuildSpreads()
                break
            case 'max-column-count':
                {
                    const maxColumnCount = parseInt(value)
                    if (maxColumnCount === this.#maxColumnCount) break
                    this.#maxColumnCount = maxColumnCount
                    this.#rebuildSpreads()
                }
                break
        }
    }
    // READAWARE: `parent` — paged frames mount on the shadow root, scrolled
    // frames mount inside their page's slot.
    async #createFrame({ index, src: srcOption }, parent = this.#root) {
        const srcOptionIsString = typeof srcOption === 'string'
        const src = srcOptionIsString ? srcOption : srcOption?.src
        const onZoom = srcOptionIsString ? null : srcOption?.onZoom
        const element = document.createElement('div')
        element.setAttribute('dir', 'ltr')
        // READAWARE: annotation overlays are positioned against this box.
        element.style.position = 'relative'
        // READAWARE: frames are born invisible; `#showFrames` (paged) or the
        // stack layout (scrolled) reveals them. `visibility` instead of
        // `display` keeps the composited layers of a cached page alive, so
        // revealing it cannot flash.
        element.style.visibility = 'hidden'
        const iframe = document.createElement('iframe')
        element.append(iframe)
        // READAWARE: the overlayer's SVG lives in the host document, above the
        // frame, and its geometry mirrors the iframe's exactly — ranges are
        // measured inside the iframe, so the two boxes must share a coordinate
        // space for a highlight to land on its own words.
        const overlay = document.createElement('div')
        Object.assign(overlay.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            transformOrigin: 'top left',
            pointerEvents: 'none',
            display: 'none',
        })
        element.append(overlay)
        Object.assign(iframe.style, {
            border: '0',
            display: 'none',
            overflow: 'hidden',
        })
        // `allow-scripts` is needed for events because of WebKit bug
        // https://bugs.webkit.org/show_bug.cgi?id=218086
        iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
        iframe.setAttribute('scrolling', 'no')
        iframe.setAttribute('part', 'filter')
        parent.append(element)
        if (!src) return { blank: true, hidden: true, element, iframe, overlay, index }
        return new Promise(resolve => {
            iframe.addEventListener('load', () => {
                const doc = iframe.contentDocument
                doc.addEventListener('wheel', event => {
                    if (!this.scrolled) return
                    event.preventDefault()
                    this.scrollBy({ top: event.deltaY, left: event.deltaX })
                }, { passive: false })
                // READAWARE: no 'load' event here. Upstream announced a frame
                // the moment its iframe loaded, which was per-navigation only
                // because frames died on navigation. Paged flows announce from
                // `#showFrames` each time a spread becomes current; the
                // scrolled stack announces once per created frame. Consumers
                // attach per-document listeners on 'load' and must dedupe.
                const { width, height } = getViewport(doc, this.defaultViewport)
                const frame = {
                    element, iframe, overlay, index, doc,
                    hidden: true,
                    width: parseFloat(width),
                    height: parseFloat(height),
                    onZoom,
                }
                // READAWARE: a lazily rendered page (PDF) has no text layer at
                // load time — there would be nothing for a CFI to anchor to.
                // Those frames get their overlayer once rendering finishes.
                if (!onZoom) this.#createOverlayer(frame)
                resolve(frame)
            }, { once: true })
            iframe.src = src
        })
    }
    // READAWARE: hand the view a fresh overlayer for this frame and mount its
    // element. Re-callable: a re-rendered page needs its annotations rebuilt
    // from their CFIs, because the ranges pointed into the discarded DOM.
    #createOverlayer(frame) {
        if (!frame?.doc) return
        this.dispatchEvent(new CustomEvent('create-overlayer', {
            detail: {
                doc: frame.doc,
                index: frame.index,
                attach: overlayer => {
                    frame.overlayer = overlayer
                    frame.overlay.replaceChildren(overlayer.element)
                    frame.overlay.style.display = 'block'
                },
            },
        }))
    }
    // READAWARE: kick a lazily rendered frame (PDF) at a given scale if its
    // raster is stale. Bookkeeping is success-based: `renderedScale` is only
    // set when a render COMPLETES, `renderingScale` marks the one in flight,
    // and a cancelled or failed render leaves the frame retryable — the old
    // requested-marks-done bookkeeping turned any transient failure into a
    // permanently blank page. Renders are cancellable through the signal the
    // PDF layer honors; a stale in-flight render (scale or palette changed)
    // is cancelled rather than raced.
    #renderFrameAt(frame, scale) {
        if (!frame?.onZoom) return
        if (frame.renderedScale === scale || frame.renderingScale === scale) return
        // Two strikes at one scale and the page stops hammering a render that
        // cannot succeed; a scale change resets the count.
        if (frame.failedScale === scale && (frame.failCount ?? 0) >= 2) return
        this.#cancelFrameRender(frame)
        const controller = new AbortController()
        frame.renderAbort = controller
        frame.renderingScale = scale
        frame.renderPromise = frame.onZoom({
            doc: frame.iframe.contentDocument,
            scale,
            pageColors: this.#pageColors,
            signal: controller.signal,
        })
            .then(() => {
                frame.renderedScale = scale
                frame.failedScale = null
                frame.failCount = 0
                this.dispatchEvent(new Event('rendered'))
                // The render rebuilt the text layer, so the overlayer's
                // ranges are detached — start it over.
                this.#createOverlayer(frame)
            })
            .catch(error => {
                if (error?.name === 'RenderCancelledError') return
                if (frame.failedScale === scale) frame.failCount = (frame.failCount ?? 0) + 1
                else { frame.failedScale = scale; frame.failCount = 1 }
                console.error(error)
            })
            .finally(() => {
                if (frame.renderAbort === controller) {
                    frame.renderAbort = null
                    frame.renderingScale = null
                }
            })
    }
    /** Cancel a frame's in-flight render (no-op when idle). Synchronous
     *  bookkeeping, so a follow-up `#renderFrameAt` never dedupes against a
     *  corpse. */
    #cancelFrameRender(frame) {
        const controller = frame?.renderAbort
        if (!controller) return
        frame.renderAbort = null
        frame.renderingScale = null
        controller.abort()
    }
    // READAWARE: cached spreads stay in the DOM; only the current one
    // participates in layout and paints. `visibility` (not `display`) so the
    // compositor keeps the hidden page's layers — revealing is then a
    // property flip, never a repaint flash.
    #setFrameHidden(frame, hidden) {
        frame.hidden = hidden
        Object.assign(frame.element.style, hidden
            ? { visibility: 'hidden', position: 'absolute', top: '0', left: '0', pointerEvents: 'none' }
            : { visibility: 'visible', position: 'relative', top: '', left: '', pointerEvents: '' })
    }
    // ─── Paged flows (single page / spreads) ─────────────────────────────────
    // READAWARE: the scale a spread renders at, extracted from `#render` so
    // background prerendering computes the same answer for a hidden spread.
    #scaleFor(left, right, center, side) {
        const l = left ?? {}
        const r = center ?? right ?? {}
        const target = side === 'left' ? l : r
        const { width, height } = this.getBoundingClientRect()
        const portrait = !this.scrolled
            && this.spread !== 'both' && this.spread !== 'portrait'
            && height > width
        const blankWidth = l.width ?? r.width ?? 0
        const blankHeight = l.height ?? r.height ?? 0

        const scale = this.scrolled
            ? width / (target.width ?? blankWidth)
            : typeof this.#zoom === 'number' && !isNaN(this.#zoom)
                ? this.#zoom
                : (this.#zoom === 'fit-width'
                    ? (portrait || center
                        ? width / (target.width ?? blankWidth)
                        : width / ((l.width ?? blankWidth) + (r.width ?? blankWidth)))
                    : (portrait || center
                        ? Math.min(
                            width / (target.width ?? blankWidth),
                            height / (target.height ?? blankHeight))
                        : Math.min(
                            width / ((l.width ?? blankWidth) + (r.width ?? blankWidth)),
                            height / Math.max(
                                l.height ?? blankHeight,
                                r.height ?? blankHeight)))
                ) || 1
        return { scale, portrait, target, blankWidth, blankHeight }
    }
    #render(side = this.#side) {
        if (this.scrolled) return this.#layoutStack()
        if (!side) return
        const left = this.#left ?? {}
        const right = this.#center ?? this.#right ?? {}
        const { scale, portrait, target, blankWidth, blankHeight } =
            this.#scaleFor(this.#left, this.#right, this.#center, side)
        this.#portrait = portrait

        const transform = frame => {
            let { element, iframe, overlay, width, height, blank, onZoom } = frame
            if (!iframe) return
            // READAWARE: re-render only when the scale actually changed. A
            // ResizeObserver tick that leaves the scale alone would otherwise
            // redraw the whole page and rebuild its overlayer for nothing.
            this.#renderFrameAt(frame, scale)
            const iframeScale = onZoom ? scale : 1
            Object.assign(iframe.style, {
                width: `${width * iframeScale}px`,
                height: `${height * iframeScale}px`,
                transform: onZoom ? 'none' : `scale(${scale})`,
                transformOrigin: 'top left',
                display: blank ? 'none' : 'block',
            })
            Object.assign(element.style, {
                width: `${(width ?? blankWidth) * scale}px`,
                height: `${(height ?? blankHeight) * scale}px`,
                overflow: 'hidden',
                display: 'block',
                flexShrink: '0',
                marginBlock: this.scrolled ? '0' : 'auto',
            })
            // READAWARE: keep the overlay box in lock-step with the iframe.
            if (overlay) {
                Object.assign(overlay.style, {
                    width: `${(width ?? blankWidth) * iframeScale}px`,
                    height: `${(height ?? blankHeight) * iframeScale}px`,
                    transform: onZoom ? 'none' : `scale(${scale})`,
                })
                // A re-rendered frame rebuilds its overlayer above; the others
                // keep their ranges and only need the new geometry drawn.
                if (!onZoom) frame.overlayer?.redraw()
            }
            if (portrait && frame !== target) {
                element.style.display = 'none'
            }
        }
        if (this.#center) {
            transform(this.#center)
        } else {
            transform(left)
            transform(right)
        }
    }
    // READAWARE: create (or reuse) the frames of one spread. Creations are
    // memoized by promise so a background preload and a user navigation
    // arriving at the same spread share one set of iframes.
    #framesFor(spreadIndex) {
        const pending = this.#framePromises.get(spreadIndex)
        if (pending) return pending
        const spread = this.#spreads[spreadIndex]
        let promise
        promise = (async () => {
            let frames
            if (spread.center) {
                const index = this.book.sections.indexOf(spread.center)
                const src = await spread.center?.load?.()
                frames = { center: await this.#createFrame({ index, src }) }
            } else {
                const indexL = this.book.sections.indexOf(spread.left)
                const indexR = this.book.sections.indexOf(spread.right)
                const srcL = await spread.left?.load?.()
                const srcR = await spread.right?.load?.()
                frames = {
                    left: await this.#createFrame({ index: indexL, src: srcL }),
                    right: await this.#createFrame({ index: indexR, src: srcR }),
                }
            }
            // An evict may have raced this creation (dropping the map rows
            // while the iframes loaded). The frames are real and the caller
            // may be about to show them — re-register unconditionally; the
            // next evict sweep applies the cap again.
            this.#framePromises.set(spreadIndex, promise)
            this.#liveFrames.set(spreadIndex, frames)
            // Into the recency order at creation — a preloaded spread the
            // reader never visits must still be evictable.
            this.#touchLRU(spreadIndex)
            return frames
        })()
        this.#framePromises.set(spreadIndex, promise)
        promise.catch(() => {
            // A failed creation must not poison the spread forever.
            this.#framePromises.delete(spreadIndex)
            this.#liveFrames.delete(spreadIndex)
        })
        return promise
    }
    #eachFrame(frames, fn) {
        for (const frame of [frames?.left, frames?.right, frames?.center])
            if (frame) fn(frame)
    }
    #showFrames(frames, side) {
        const next = new Set([frames.left, frames.right, frames.center])
        for (const frame of [this.#left, this.#right, this.#center])
            if (frame && !next.has(frame)) this.#setFrameHidden(frame, true)
        this.#left = frames.left ?? null
        this.#right = frames.right ?? null
        this.#center = frames.center ?? null
        this.#eachFrame(frames, frame => this.#setFrameHidden(frame, false))
        this.#side = frames.center ? 'center'
            : this.#left?.blank ? 'right'
                : this.#right?.blank ? 'left' : side
        // READAWARE: announce the spread's documents on every show — the same
        // per-navigation 'load' consumers always got, now decoupled from
        // iframe creation so cached spreads keep the contract. Listeners that
        // attach to the document must dedupe (the doc may be the same one).
        this.#eachFrame(frames, frame => {
            if (frame.doc) this.dispatchEvent(new CustomEvent('load', {
                detail: { doc: frame.doc, index: frame.index },
            }))
        })
        this.#render()
    }
    #touchLRU(spreadIndex) {
        const at = this.#lru.indexOf(spreadIndex)
        if (at >= 0) this.#lru.splice(at, 1)
        this.#lru.push(spreadIndex)
    }
    #evict() {
        const cap = this.#spreads.length <= FULL_RENDER_MAX_SPREADS
            ? Infinity : CACHE_MAX_SPREADS
        if (this.#liveFrames.size <= cap) return
        // Never evict the spread being read or its immediate window — those
        // are exactly the ones a turn is about to need.
        const keep = new Set()
        for (let i = this.#index - PRELOAD_SPREADS_BEHIND;
            i <= this.#index + PRELOAD_SPREADS_AHEAD; i++) keep.add(i)
        for (const victim of [...this.#lru]) {
            if (this.#liveFrames.size <= cap) break
            if (keep.has(victim)) continue
            const frames = this.#liveFrames.get(victim)
            if (frames) this.#eachFrame(frames, frame => {
                this.#cancelFrameRender(frame)
                frame.element.remove()
            })
            this.#liveFrames.delete(victim)
            this.#framePromises.delete(victim)
            this.#lru.splice(this.#lru.indexOf(victim), 1)
        }
    }
    // READAWARE: warm the spreads a reader is about to turn to. Small books
    // (≤ FULL_RENDER_MAX_SPREADS) prerender completely, nearest first; larger
    // books keep a sliding window. Strictly sequential, and starting only
    // after the visible spread's own renders settle, so preloading never
    // competes with the page being read for the PDF worker. A newer
    // navigation bumps the token and the stale chain stops where it is —
    // anything it already built stays cached.
    #schedulePreload() {
        const token = ++this.#preloadToken
        const origin = this.#index
        const total = this.#spreads?.length ?? 0
        if (origin < 0 || total === 0) return
        const order = []
        if (total <= FULL_RENDER_MAX_SPREADS) {
            for (let d = 1; d < total; d++) {
                if (origin + d < total) order.push(origin + d)
                if (origin - d >= 0) order.push(origin - d)
            }
        } else {
            for (let d = 1; d <= PRELOAD_SPREADS_AHEAD; d++)
                if (origin + d < total) order.push(origin + d)
            for (let d = 1; d <= PRELOAD_SPREADS_BEHIND; d++)
                if (origin - d >= 0) order.push(origin - d)
        }
        void (async () => {
            const current = [this.#left, this.#right, this.#center]
            await Promise.allSettled(current.map(frame => frame?.renderPromise))
            for (const spreadIndex of order) {
                if (token !== this.#preloadToken) return
                if (spreadIndex === this.#index) continue
                try {
                    const frames = await this.#framesFor(spreadIndex)
                    if (token !== this.#preloadToken) return
                    const spread = this.#spreads[spreadIndex]
                    const side = spread.center ? 'center'
                        : this.rtl ? 'right' : 'left'
                    const { scale } = this.#scaleFor(
                        frames.left, frames.right, frames.center, side)
                    this.#eachFrame(frames, frame => this.#renderFrameAt(frame, scale))
                    await Promise.allSettled(
                        [frames.left, frames.right, frames.center]
                            .map(frame => frame?.renderPromise))
                } catch (error) {
                    console.error(error)
                }
                if (token !== this.#preloadToken) return
                this.#evict()
            }
        })()
    }
    // ─── Scrolled flow: a continuous stack of pages ──────────────────────────
    // READAWARE: upstream's scrolled flow was still one spread at a time —
    // scrolling reached the bottom of a page and the next one replaced it
    // wholesale. This is a real continuous scroller instead: every page owns
    // a correctly-sized slot (so the scrollbar and jump targets are honest
    // for the whole document), and only slots near the viewport hold live,
    // rendered frames. Far pages tear back down to their placeholders.
    #stackDims(entry) {
        if (entry.width && entry.height) return entry
        if (this.#stackDefaultDims) return this.#stackDefaultDims
        const viewport = typeof this.defaultViewport === 'object'
            ? this.defaultViewport : null
        if (viewport?.width && viewport.height) return {
            width: parseFloat(viewport.width), height: parseFloat(viewport.height),
        }
        return { width: 1000, height: 1414 }
    }
    // READAWARE: `width` may be passed by batch callers — reading
    // `clientWidth` forces a synchronous reflow, and doing that once per slot
    // while appending thousands of slots is O(n²) layout (9 s of the open
    // time of a 3,246-page book, measured).
    #stackScale(entry, width = this.clientWidth) {
        const dims = this.#stackDims(entry)
        return (width / dims.width) || 1
    }
    #buildStack() {
        this.#teardownStack()
        const total = this.#spreads.length
        this.#stack = Array.from({ length: total }, () => ({
            slot: document.createElement('div'),
            frame: null,
            framePromise: null,
            width: 0,
            height: 0,
        }))
        // One width read and one DOM insertion for the whole stack.
        const width = this.clientWidth
        const fragment = document.createDocumentFragment()
        for (const entry of this.#stack) {
            Object.assign(entry.slot.style, {
                position: 'relative',
                flexShrink: '0',
                overflow: 'hidden',
            })
            this.#sizeSlot(entry, width)
            fragment.append(entry.slot)
        }
        this.#root.append(fragment)
        this.#restackTops()
    }
    #sizeSlot(entry, width = this.clientWidth) {
        const dims = this.#stackDims(entry)
        const scale = this.#stackScale(entry, width)
        entry.pixelHeight = dims.height * scale
        entry.slot.style.width = `${dims.width * scale}px`
        entry.slot.style.height = `${entry.pixelHeight}px`
        // A slot whose page isn't rastered yet shows as sheet-colored paper,
        // not a white slab in a dark room.
        entry.slot.style.background = this.#pageColors?.background ?? ''
    }
    // READAWARE: slot offsets are tracked arithmetically — `offsetTop` is not
    // dependable across a shadow boundary, and a 3000-slot layout read per
    // scroll frame would thrash anyway.
    #restackTops() {
        let top = 0
        for (const entry of this.#stack) {
            entry.top = top
            top += entry.pixelHeight
        }
    }
    #teardownStack() {
        if (!this.#stack) return
        for (const i of [...this.#stackLive]) this.#demoteStackFrame(i)
        for (const entry of this.#stack) entry.slot.remove()
        this.#stack = null
        this.#stackLive.clear()
        this.#stackWanted.clear()
        if (this.#stackReportTimer) clearTimeout(this.#stackReportTimer)
    }
    /** The stack entry whose slot contains the viewport's center line. */
    #stackIndexAt(scrollCenter) {
        if (!this.#stack?.length) return 0
        let lo = 0, hi = this.#stack.length - 1
        while (lo < hi) {
            const mid = (lo + hi) >> 1
            const entry = this.#stack[mid]
            if (entry.top + entry.pixelHeight <= scrollCenter) lo = mid + 1
            else hi = mid
        }
        return lo
    }
    async #ensureStackFrame(entryIndex) {
        const entry = this.#stack?.[entryIndex]
        if (!entry) return null
        if (entry.framePromise) return entry.framePromise
        this.#stackLive.add(entryIndex)
        const spread = this.#spreads[entryIndex]
        const sectionIndex = this.book.sections.indexOf(
            spread.center ?? spread.left ?? spread.right)
        let promise
        promise = (async () => {
            const section = spread.center ?? spread.left ?? spread.right
            const src = await section?.load?.()
            const frame = await this.#createFrame(
                { index: sectionIndex, src }, entry.slot)
            // The stack may have been torn down (mode switch), or this entry
            // demoted (scrolled far away), while the iframe was loading — a
            // demoted creation must NOT resurrect itself, or the frame
            // becomes an orphan no sweep tracks. The drain re-creates it if
            // the reader comes back.
            if (this.#stack?.[entryIndex] !== entry || entry.framePromise !== promise) {
                frame.element.remove()
                return null
            }
            entry.frame = frame
            if (!frame.blank) {
                // First real page dimensions become the placeholder default,
                // and this page's own slot takes its exact size. Growth above
                // the viewport would shove the reading position — compensate.
                this.#stackDefaultDims ??= { width: frame.width, height: frame.height }
                const before = entry.pixelHeight
                entry.width = frame.width
                entry.height = frame.height
                this.#sizeSlot(entry)
                const delta = entry.pixelHeight - before
                if (delta !== 0) {
                    this.#restackTops()
                    // Growth above the reading position would shove the page
                    // under the reader — keep the view anchored.
                    if (entry.top < this.scrollTop) this.scrollTop += delta
                }
            }
            Object.assign(frame.element.style, {
                position: 'absolute',
                top: '0',
                left: '0',
                visibility: 'visible',
            })
            frame.hidden = false
            if (frame.doc) this.dispatchEvent(new CustomEvent('load', {
                detail: { doc: frame.doc, index: frame.index },
            }))
            this.#layoutStackFrame(entry)
            return frame
        })()
        entry.framePromise = promise
        promise.catch(() => {
            if (this.#stack?.[entryIndex] === entry) {
                entry.framePromise = null
                entry.frame = null
                this.#stackLive.delete(entryIndex)
            }
        })
        return promise
    }
    #layoutStackFrame(entry) {
        const frame = entry.frame
        if (!frame || frame.blank) return
        const scale = this.#stackScale(entry)
        this.#renderFrameAt(frame, scale)
        const iframeScale = frame.onZoom ? scale : 1
        Object.assign(frame.iframe.style, {
            width: `${frame.width * iframeScale}px`,
            height: `${frame.height * iframeScale}px`,
            transform: frame.onZoom ? 'none' : `scale(${scale})`,
            transformOrigin: 'top left',
            display: 'block',
        })
        Object.assign(frame.overlay.style, {
            width: `${frame.width * iframeScale}px`,
            height: `${frame.height * iframeScale}px`,
            transform: frame.onZoom ? 'none' : `scale(${scale})`,
        })
        if (!frame.onZoom) frame.overlayer?.redraw()
    }
    #demoteStackFrame(entryIndex) {
        const entry = this.#stack?.[entryIndex]
        if (!entry || (!entry.frame && !entry.framePromise)) return
        const frame = entry.frame
        if (frame) {
            this.#cancelFrameRender(frame)
            frame.element.remove()
        }
        entry.frame = null
        entry.framePromise = null
        this.#stackLive.delete(entryIndex)
    }
    #layoutStack() {
        if (!this.#stack) return
        const width = this.clientWidth
        for (const entry of this.#stack) this.#sizeSlot(entry, width)
        this.#restackTops()
        for (const i of this.#stackLive) {
            const entry = this.#stack[i]
            if (entry) this.#layoutStackFrame(entry)
        }
        this.#updateStackWindow('layout')
    }
    // READAWARE: the heart of the scrolled flow — called on scroll (throttled),
    // on resize, and after navigations. Reports the new reading position,
    // recomputes the wanted window (binary search over slot offsets, never a
    // full sweep of thousands of entries), demotes what fell out of the keep
    // range, and kicks the drain loop that does the actual work.
    #updateStackWindow(reason) {
        if (!this.#stack?.length) return
        const height = this.clientHeight
        const top = this.scrollTop
        const center = top + height / 2
        const current = this.#stackIndexAt(center)
        if (current !== this.#stackCurrent || this.#index < 0) {
            this.#stackCurrent = current
            this.#index = current
            // Debounced: a fling crosses many pages; report where it rests.
            if (this.#stackReportTimer) clearTimeout(this.#stackReportTimer)
            this.#stackReportTimer = setTimeout(() => {
                this.#stackReportTimer = 0
                this.#reportLocation(reason === 'layout' ? 'page' : reason)
            }, 120)
        }

        const full = this.#stack.length <= FULL_RENDER_MAX_SPREADS
        const wanted = new Set()
        if (full) {
            for (let i = 0; i < this.#stack.length; i++) wanted.add(i)
        } else {
            const first = this.#stackIndexAt(top - height * STACK_BEHIND_VIEWPORTS)
            const last = this.#stackIndexAt(top + height * (1 + STACK_AHEAD_VIEWPORTS))
            for (let i = first; i <= last; i++) wanted.add(i)
            const keepFirst = this.#stackIndexAt(top - height * STACK_KEEP_BEHIND_VIEWPORTS)
            const keepLast = this.#stackIndexAt(top + height * (1 + STACK_KEEP_AHEAD_VIEWPORTS))
            for (const i of [...this.#stackLive]) {
                if (i < keepFirst || i > keepLast) this.#demoteStackFrame(i)
                // Kept but no longer wanted: stop spending the main thread on
                // its raster — the reader is moving away from it.
                else if (!wanted.has(i)) this.#cancelFrameRender(this.#stack[i]?.frame)
            }
        }
        this.#stackWanted = wanted
        void this.#drainStack()
    }
    /**
     * READAWARE: the single consumer that builds and renders wanted pages,
     * nearest-to-the-reader first. It re-picks after every await, so a scroll
     * that moved the window mid-render simply changes what gets picked next —
     * no restarts, no lost work, and the current page always wins the PDF
     * worker. Lives until nothing in the wanted set needs work.
     */
    async #drainStack() {
        if (this.#stackDraining) return
        this.#stackDraining = true
        try {
            for (;;) {
                if (!this.#stack) return
                const current = this.#stackCurrent
                let best = null
                let bestDistance = Infinity
                for (const i of this.#stackWanted) {
                    const entry = this.#stack[i]
                    if (!entry || !this.#stackEntryNeedsWork(entry)) continue
                    const distance = Math.abs(i - current)
                    if (distance < bestDistance) {
                        bestDistance = distance
                        best = i
                    }
                }
                if (best === null) {
                    // Nothing to start — but renders may be in flight; wait
                    // for one to settle and re-check rather than exiting with
                    // work outstanding.
                    const inflight = [...this.#stackWanted]
                        .map(i => this.#stack[i]?.frame)
                        .filter(frame => frame?.renderingScale != null)
                        .map(frame => frame.renderPromise)
                    if (inflight.length === 0) return
                    await Promise.race(inflight)
                    continue
                }
                const entry = this.#stack[best]
                try {
                    const frame = await this.#ensureStackFrame(best)
                    if (!this.#stack || this.#stack[best] !== entry) continue
                    if (frame && entry.frame === frame) {
                        this.#layoutStackFrame(entry)
                        await frame.renderPromise
                    }
                } catch (error) {
                    console.error(error)
                }
            }
        } finally {
            this.#stackDraining = false
        }
    }
    /** Needs creating, or needs (re)rendering at the current scale and hasn't
     *  struck out. Mirrors `#renderFrameAt`'s own guards so the drain loop
     *  cannot spin on a page it would refuse to render. */
    #stackEntryNeedsWork(entry) {
        const frame = entry.frame
        // No frame yet: creating (or waiting to create) — the drain awaits
        // the shared creation promise and then kicks the render.
        if (!frame) return true
        if (frame.blank || !frame.onZoom) return false
        const scale = this.#stackScale(entry)
        if (frame.renderedScale === scale || frame.renderingScale === scale) return false
        if (frame.failedScale === scale && (frame.failCount ?? 0) >= 2) return false
        return true
    }
    async #goToStack(index, reason) {
        if (!this.#stack) return
        const clamped = Math.max(0, Math.min(index, this.#stack.length - 1))
        const entry = this.#stack[clamped]
        this.#stackCurrent = clamped
        this.#index = clamped
        this.scrollTop = entry.top
        this.#updateStackWindow('navigation')
        this.#reportLocation(reason ?? 'navigation')
        await this.#ensureStackFrame(clamped)
    }
    #onResize() {
        if (this.scrolled && this.#stack) {
            // Keep the reading position anchored while every slot resizes.
            const entry = this.#stack[this.#stackCurrent]
            const offset = entry
                ? (this.scrollTop - entry.top) / Math.max(1, entry.pixelHeight)
                : 0
            this.#layoutStack()
            if (entry) this.scrollTop = entry.top + offset * entry.pixelHeight
            return
        }
        this.#render()
    }
    #clearFrameCache() {
        this.#preloadToken++
        for (const frames of this.#liveFrames.values())
            this.#eachFrame(frames, frame => {
                this.#cancelFrameRender(frame)
                frame.element.remove()
            })
        this.#liveFrames.clear()
        this.#framePromises.clear()
        this.#lru = []
        this.#left = null
        this.#right = null
        this.#center = null
        this.#teardownStack()
        this.#stackDefaultDims = null
        this.#root.replaceChildren()
    }
    #goLeft() {
        if (this.#center || this.#left?.blank) return
        if (this.#portrait && this.#left?.element?.style?.display === 'none') {
            this.#side = 'left'
            this.#render()
            this.#reportLocation('page')
            return true
        }
    }
    #goRight() {
        if (this.#center || this.#right?.blank) return
        if (this.#portrait && this.#right?.element?.style?.display === 'none') {
            this.#side = 'right'
            this.#render()
            this.#reportLocation('page')
            return true
        }
    }
    open(book) {
        this.book = book
        const { rendition } = book
        this.defaultViewport = rendition?.viewport

        const rtl = book.dir === 'rtl'
        this.rtl = rtl

        this.#buildSpreads()
        if (this.scrolled) this.#buildStack()
    }
    #buildSpreads() {
        if (!this.book) return
        const { rendition } = this.book
        const maxColumnCount = this.#maxColumnCount
            ?? parseInt(this.getAttribute('max-column-count'))
        const singlePage = this.scrolled || maxColumnCount === 1
            || !maxColumnCount && rendition?.spread === 'none'
        this.spread = singlePage ? 'none'
            : rendition?.spread === 'none' ? undefined : rendition?.spread

        const rtl = this.rtl
        const ltr = !rtl

        if (singlePage)
            this.#spreads = this.book.sections.map(section => ({ center: section }))
        else this.#spreads = this.book.sections.reduce((arr, section, i) => {
            const last = arr[arr.length - 1]
            const { pageSpread } = section
            const newSpread = () => {
                const spread = {}
                arr.push(spread)
                return spread
            }
            if (pageSpread === 'center') {
                const spread = last.left || last.right ? newSpread() : last
                spread.center = section
            }
            else if (pageSpread === 'left') {
                const spread = last.center || last.left || ltr && i ? newSpread() : last
                spread.left = section
            }
            else if (pageSpread === 'right') {
                const spread = last.center || last.right || rtl && i ? newSpread() : last
                spread.right = section
            }
            else if (ltr) {
                if (last.center || last.right) newSpread().left = section
                else if (last.left || !i) last.right = section
                else last.left = section
            }
            else {
                if (last.center || last.left) newSpread().right = section
                else if (last.right || !i) last.left = section
                else last.right = section
            }
            return arr
        }, [{}])
    }
    #rebuildSpreads() {
        if (!this.book) return
        const currentIndex = this.index
        this.#buildSpreads()
        // READAWARE: the spread composition (or the flow) changed, so every
        // cached frame belongs to a layout that no longer exists.
        this.#clearFrameCache()
        if (this.scrolled) this.#buildStack()
        this.#index = -1
        if (currentIndex >= 0) void this.goTo({ index: currentIndex })
    }
    // READAWARE: page colors for lazily rendered frames (PDF), as
    // `{ background, foreground? }` — see pdf.js for what each one means — or
    // null to render the page as authored. Baked into the render, so a change
    // invalidates every live frame's cached scale to force a redraw — cached
    // hidden spreads included, or turning a page after a palette change would
    // flash the old colors.
    setPageColors(pageColors) {
        const next = pageColors?.background ? pageColors : null
        if (next?.background === this.#pageColors?.background
            && next?.foreground === this.#pageColors?.foreground) return
        this.#pageColors = next
        for (const frames of this.#liveFrames.values())
            this.#eachFrame(frames, frame => {
                this.#cancelFrameRender(frame)
                frame.renderedScale = null
            })
        if (this.#stack) {
            const width = this.clientWidth
            for (const entry of this.#stack) {
                if (entry.frame) {
                    this.#cancelFrameRender(entry.frame)
                    entry.frame.renderedScale = null
                }
                this.#sizeSlot(entry, width)
            }
        }
        this.#render()
        // Repaint the warm window in the new colors behind the visible page.
        if (!this.scrolled) this.#schedulePreload()
    }
    setLayout(flow, maxColumnCount) {
        this.#flow = flow
        this.#maxColumnCount = maxColumnCount
        this.setAttribute('flow', flow)
        this.setAttribute('max-column-count', String(maxColumnCount))
        this.#rebuildSpreads()
    }
    get scrolled() {
        return (this.#flow ?? this.getAttribute('flow')) === 'scrolled'
    }
    get start() {
        return this.scrollTop
    }
    get end() {
        return this.scrollTop + this.clientHeight
    }
    get viewSize() {
        return this.scrollHeight
    }
    get index() {
        const spread = this.#spreads?.[this.#index]
        if (!spread) return -1
        const section = spread.center ?? (this.#side === 'left'
            ? spread.left ?? spread.right : spread.right ?? spread.left)
        return this.book.sections.indexOf(section)
    }
    #reportLocation(reason) {
        this.dispatchEvent(new CustomEvent('relocate', { detail:
            { reason, range: null, index: this.index, fraction: 0, size: 1 } }))
    }
    getSpreadOf(section) {
        const spreads = this.#spreads
        for (let index = 0; index < spreads.length; index++) {
            const { left, right, center } = spreads[index]
            if (left === section) return { index, side: 'left' }
            if (right === section) return { index, side: 'right' }
            if (center === section) return { index, side: 'center' }
        }
    }
    async goToSpread(index, side, reason) {
        if (index < 0 || index > this.#spreads.length - 1) return
        if (this.scrolled) return this.#goToStack(index, reason)
        if (index === this.#index) {
            this.#render(side)
            return
        }
        this.#index = index
        const frames = await this.#framesFor(index)
        // READAWARE: a newer navigation landed while the frames were loading —
        // it owns the display now.
        if (this.#index !== index) return
        this.#showFrames(frames, side)
        this.#reportLocation(reason)
        this.#touchLRU(index)
        this.#evict()
        this.#schedulePreload()
    }
    async select(target) {
        await this.goTo(target)
        // TODO
    }
    async goTo(target) {
        const { book } = this
        const resolved = await target
        const section = book.sections[resolved.index]
        if (!section) return
        const { index, side } = this.getSpreadOf(section)
        await this.goToSpread(index, side)
    }
    async next() {
        if (this.scrolled)
            return this.#goToStack(this.#stackCurrent + 1, 'page')
        const s = this.rtl ? this.#goLeft() : this.#goRight()
        if (!s) await this.goToSpread(this.#index + 1, this.rtl ? 'right' : 'left', 'page')
    }
    async prev() {
        if (this.scrolled)
            return this.#goToStack(this.#stackCurrent - 1, 'page')
        const s = this.rtl ? this.#goRight() : this.#goLeft()
        if (!s) await this.goToSpread(this.#index - 1, this.rtl ? 'left' : 'right', 'page')
    }
    // READAWARE: report the frames themselves rather than raw iframes, so the
    // view can find the section index and overlayer an annotation belongs to.
    // The page being read comes first — `getContents()[0]` is "the current
    // page" to consumers — followed by the other live frames, so annotation
    // edits reach warm cached pages too.
    getContents() {
        if (this.scrolled && this.#stack) {
            const current = this.#stackCurrent
            return this.#stack
                .map((entry, i) => ({ entry, distance: Math.abs(i - current) }))
                .filter(({ entry }) => entry.frame?.doc)
                .sort((a, b) => a.distance - b.distance)
                .map(({ entry }) => ({
                    doc: entry.frame.doc,
                    index: entry.frame.index,
                    overlayer: entry.frame.overlayer,
                }))
        }
        const current = [this.#left, this.#right, this.#center]
            .filter(frame => frame?.doc)
        const seen = new Set(current)
        const cached = []
        for (const frames of this.#liveFrames.values())
            this.#eachFrame(frames, frame => {
                if (frame.doc && !seen.has(frame)) cached.push(frame)
            })
        return [...current, ...cached]
            .map(({ doc, index, overlayer }) => ({ doc, index, overlayer }))
    }
    destroy() {
        this.#observer.unobserve(this)
        this.removeEventListener('scroll', this.#onStackScroll)
        this.#clearFrameCache()
    }
}

customElements.define('foliate-fxl', FixedLayout)
