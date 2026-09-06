import type { Book, BookFile, PageColors, PageSource } from './book.js'
import * as pdfjsLib from './vendor/pdfjs/pdf.mjs'
import type { PDFPage, PDFDestination, LoadingTask } from './vendor/pdfjs/pdf.mjs'
import { getPDFMetadata } from './pdf-metadata.js'
import { BookRangeTransport } from './pdf-transport.js'
import { makePDFTOCItem, resolvePDFHref } from './pdf-navigation.js'

const pdfjsPath = (path: string) => new URL(`vendor/pdfjs/${path}`, import.meta.url).toString()

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsPath('pdf.worker.mjs')

const fetchText = async (url: string): Promise<string> => {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Could not load PDF stylesheet: ${response.status}`)
    return response.text()
}

// https://raw.githubusercontent.com/mozilla/pdf.js/refs/tags/v5.5.207/web/text_layer_builder.css
const textLayerBuilderCSS = await fetchText(pdfjsPath('text_layer_builder.css'))

// https://raw.githubusercontent.com/mozilla/pdf.js/refs/tags/v5.5.207/web/annotation_layer_builder.css
const annotationLayerBuilderCSS = await fetchText(pdfjsPath('annotation_layer_builder.css'))

const COVER_MAX_EDGE = 480
const COVER_SCAN_PAGES = 5
const COVER_RENDER_BUDGET_MS = 2500

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) =>
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to render PDF cover')),
        'image/png'))

const thumbnailFromCanvas = async (source: HTMLCanvasElement) => {
    const scale = Math.min(1, COVER_MAX_EDGE / Math.max(source.width, source.height))
    const canvas = document.createElement('canvas')
    canvas.height = Math.max(1, Math.round(source.height * scale))
    canvas.width = Math.max(1, Math.round(source.width * scale))
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('Could not create PDF thumbnail context')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(source, 0, 0, canvas.width, canvas.height)

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let ink = 0
    for (let i = 0; i < pixels.length; i += 16) {
        if (pixels[i] < 245 || pixels[i + 1] < 245 || pixels[i + 2] < 245) ink++
    }
    const samples = pixels.length / 16
    return {
        blob: await canvasToBlob(canvas),
        meaningful: ink >= Math.max(24, samples * 0.001),
        timedOut: false,
    }
}

const renderCoverPage = async (page: PDFPage, deadline: number) => {
    const remaining = deadline - performance.now()
    if (remaining <= 0) return { blob: null, meaningful: false, timedOut: true }
    const natural = page.getViewport({ scale: 1 })
    const scale = Math.min(1, COVER_MAX_EDGE / Math.max(natural.width, natural.height))
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.height = Math.max(1, Math.round(viewport.height))
    canvas.width = Math.max(1, Math.round(viewport.width))
    const canvasContext = canvas.getContext('2d', { alpha: false })
    if (!canvasContext) throw new Error('Could not create PDF cover context')
    canvasContext.fillStyle = '#fff'
    canvasContext.fillRect(0, 0, canvas.width, canvas.height)
    // READAWARE: `intent: "print"` — display-intent rendering paces itself
    // with requestAnimationFrame, which WKWebView suspends entirely while
    // the window is occluded. A cover is an offscreen thumbnail extracted at
    // import time; drag a batch of PDFs in and switch away, and every cover
    // would silently time out against its budget, leaving the shelf blank
    // until each book's first open. Print intent renders without the
    // animation-frame dependency.
    const task = page.render({ canvas, viewport, intent: 'print' })
    const timeout = setTimeout(() => task.cancel(), remaining)
    try {
        await task.promise
    } catch (error) {
        if (performance.now() >= deadline
        || error instanceof Error && error.name === 'RenderingCancelledException')
            return { blob: null, meaningful: false, timedOut: true }
        throw error
    } finally {
        clearTimeout(timeout)
    }

    return thumbnailFromCanvas(canvas)
}

const extractPageText = async (page: PDFPage): Promise<string> => {
    let text = ''
    // `PDFPageProxy.getTextContent()` consumes the stream with `for await`;
    // older WKWebView releases lack ReadableStream's async iterator even when
    // using PDF.js's legacy build. Reading through the stable reader API keeps
    // extraction on the same compatibility baseline as page rendering.
    const reader = page.streamTextContent().getReader()
    try {
        while (true) {
            const { value, done } = await reader.read()
            if (done) break
            for (const item of value?.items ?? []) {
                if (!('str' in item)) continue
                text += item.str
                text += item.hasEOL ? '\n' : ' '
            }
        }
    } finally {
        reader.releaseLock()
    }
    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

// READAWARE: page colors, in two forms.
//
// `background` alone is painted before the page is drawn on top of it
// (`beginDrawing` fills the canvas with it), so a light palette tints the sheet
// with every ink and photograph left exactly as authored. That is a render
// parameter and costs nothing.
//
// `background` + `foreground` is the dark case: black ink cannot be painted
// onto a dark sheet, so the page's tonal range has to be remapped between the
// two colors — paper to `background`, ink to `foreground`, everything between
// interpolated. The page keeps its detail and loses its color.
//
// That remap is done with composite operations, and NOT with a filter. Every
// filter route fails on macOS WKWebView, each in its own quiet way:
//
// - PDF.js's own `render({ pageColors })` assigns an SVG filter to the canvas
//   2D context. `ctx.filter` round-trips and nothing renders differently — and
//   the same is true of the shorthand functions (`grayscale(1) invert(1)`).
//   Canvas filters simply do not run there.
// - The same filter on the canvas *element* via CSS does run — until the canvas
//   gets large. Scroll mode renders a page at fit-width times the device pixel
//   ratio, which on a Retina display is thousands of pixels square, past
//   WebKit's filter-region limit: the output comes back empty and the page
//   vanishes into the background color, which is what a reader sees as "dark
//   mode makes the page disappear".
//
// Composite operations have neither problem, and unlike a pixel loop they stay
// on the GPU. They run once per render — a page turn, a zoom, a palette change
// — never per frame.
const rgbChannels = (color: string): number[] | null => {
    const hex = String(color).trim().replace(/^#/, '')
    const full = hex.length === 3 || hex.length === 4
        ? [...hex.slice(0, 3)].map(c => c + c).join('')
        : hex.slice(0, 6)
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16))
}

const clampChannel = (value: number) => Math.max(0, Math.min(255, Math.round(value)))

// The remap, as four composite operations over the finished page. Each one is
// a plain fill the compositor can run on the GPU; the equivalent pixel loop
// costs a third of a second on a Retina-scale page, which a page turn cannot
// afford. Endpoints land exactly: white paper comes out as `background`, black
// ink as `foreground`.
const applyPageColors = (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, pageColors?: PageColors) => {
    if (!pageColors?.foreground || !pageColors?.background) return
    const fg = rgbChannels(pageColors.foreground)
    const bg = rgbChannels(pageColors.background)
    if (!fg || !bg) return
    const { width, height } = canvas
    const fill = (style: string) => {
        context.fillStyle = style
        context.fillRect(0, 0, width, height)
    }

    context.save()
    // Drop the color, keeping each pixel's luminosity.
    context.globalCompositeOperation = 'saturation'
    fill('hsl(0, 0%, 50%)')
    // Invert, so paper sits at 0 and ink at 1.
    context.globalCompositeOperation = 'difference'
    fill('#ffffff')
    // Scale that range down to the distance between the two colors. A palette
    // whose text is darker than its paper in some channel would ask for a
    // negative scale, which cannot be expressed — clamping flattens that
    // channel rather than wrapping it.
    context.globalCompositeOperation = 'multiply'
    fill(`rgb(${fg.map((c, i) => clampChannel(c - bg[i])).join(', ')})`)
    // And lift the result onto the background color.
    context.globalCompositeOperation = 'lighter'
    fill(`rgb(${bg.map(clampChannel).join(', ')})`)
    context.restore()
}

// READAWARE: per-document selection manager for the text layer — the WebKit
// path of PDF.js's text_layer_builder (PR #17923), adapted to our one page
// per iframe document. Two cooperating tricks:
//
//  - `.selecting` rides on the text layer for the duration of any pointer
//    drag — registered on the DOCUMENT, so a drag that starts on blank paper
//    still counts. The vendored CSS expands `.endOfContent` from "parked
//    below the page" (inset 100% 0 0) to covering it (top: 0), giving the
//    native selection a continuous surface instead of span islands.
//  - on every selectionchange, `.endOfContent` is re-inserted in DOM order
//    next to the selection's MOVING edge, so the boundary the browser
//    extends from always has a contiguous neighbor — the inter-span gaps
//    disappear from the selection model's point of view.
//
// One listener set per document; re-renders (zoom, palette) only swap which
// container/divider the state points at.
type SelectionState = { container: HTMLElement; end: HTMLElement; prevRange: Range | null }
const selectionFixStates = new WeakMap<Document, SelectionState>()
const bindSelectionFixes = (doc: Document, container: HTMLElement, endOfContent: HTMLElement) => {
    const existing = selectionFixStates.get(doc)
    if (existing) {
        existing.container = container
        existing.end = endOfContent
        existing.prevRange = null
        return
    }
    const state: SelectionState = { container, end: endOfContent, prevRange: null }
    selectionFixStates.set(doc, state)
    const reset = () => {
        state.container.classList.remove('selecting')
        state.prevRange = null
        // Park the divider back below the page (last in DOM order).
        if (state.end.parentElement) state.container.append(state.end)
    }
    doc.addEventListener('pointerdown', () => state.container.classList.add('selecting'))
    doc.addEventListener('pointerup', reset)
    doc.addEventListener('pointercancel', reset)
    doc.defaultView?.addEventListener('blur', reset)
    doc.addEventListener('selectionchange', () => {
        const selection = doc.getSelection()
        if (!selection || selection.rangeCount === 0) {
            state.prevRange = null
            return
        }
        const range = selection.getRangeAt(0)
        // Which edge is moving? If the end boundary matches the previous
        // selection, the user is dragging the start backwards.
        const modifyStart = state.prevRange
            && (range.compareBoundaryPoints(Range.END_TO_END, state.prevRange) === 0
                || range.compareBoundaryPoints(Range.START_TO_END, state.prevRange) === 0)
        let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer
        if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode
        // A selection ending exactly at an element boundary anchors on the
        // PREVIOUS element (upstream's walk, bounded to the layer).
        if (!modifyStart && range.endOffset === 0) {
            do {
                while (anchor && !anchor.previousSibling && anchor !== state.container) {
                    anchor = anchor.parentNode
                }
                if (!anchor || anchor === state.container) break
                anchor = anchor.previousSibling
            } while (anchor && !anchor.childNodes.length && anchor !== state.end)
        }
        if (
            anchor
            && anchor !== state.container
            && anchor !== state.end
            && anchor.parentElement
            && state.container.contains(anchor)
        ) {
            anchor.parentElement.insertBefore(
                state.end, modifyStart ? anchor : anchor.nextSibling)
        }
        state.prevRange = range.cloneRange()
    })
}

// READAWARE: the raster budget, in canvas pixels. `zoom × devicePixelRatio`
// is unbounded — fit-width on a large Retina window asks a tall scan for a
// 20-megapixel canvas (~90 MB of RGBA) per page, which is where scrolling
// jank and compositor memory pressure come from. Above the budget the page
// rasters at the largest scale that fits and the (generalized) document
// transform upscales the difference; at typical window sizes the budget is
// never hit and rendering is pixel-exact as before.
const MAX_RENDER_PIXELS = 12 * 1024 * 1024

// READAWARE: renders are cancellable (see the fixed-layout scheduler): a page
// scrolled out of the window before its raster finished must release the main
// thread and the PDF worker to pages the reader is actually approaching. A
// cancelled render throws this recognizable name; callers treat it as "not
// rendered", never as damage.
class RenderCancelledError extends Error {
    declare name: string;

    constructor() {
        super('pdf render cancelled')
        this.name = 'RenderCancelledError'
    }
}

const render = async (page: PDFPage, doc: Document, zoom: number,
    onRendered?: (canvas: HTMLCanvasElement) => void, pageColors?: PageColors, signal?: AbortSignal): Promise<void> => {
    const throwIfAborted = () => {
        if (signal?.aborted) throw new RenderCancelledError()
    }
    throwIfAborted()
    const natural = page.getViewport({ scale: 1 })
    let scale = zoom * devicePixelRatio
    const maxScale = Math.sqrt(MAX_RENDER_PIXELS / (natural.width * natural.height))
    if (scale > maxScale) scale = maxScale
    // Generalized from `1 / devicePixelRatio`: displayed size = raster × t,
    // and the display target is the layout size (zoom).
    doc.documentElement.style.transform = `scale(${zoom / scale})`
    doc.documentElement.style.transformOrigin = 'top left'
    doc.documentElement.style.setProperty('--scale-factor', String(scale))
    const viewport = page.getViewport({ scale })

    // the canvas must be in the `PDFDocument`'s `ownerDocument`
    // (`globalThis.document` by default); that's where the fonts are loaded
    const canvas = document.createElement('canvas')
    canvas.height = viewport.height
    canvas.width = viewport.width
    const canvasContext = canvas.getContext('2d')
    if (!canvasContext) throw new Error('Could not create PDF page context')
    // READAWARE: paint the page document to match, so the moment between the
    // old canvas being replaced and the new one appearing does not flash white.
    doc.documentElement.style.background = pageColors?.background ?? ''
    const task = page.render({
        canvas, viewport,
        // Only the light case is a render parameter; the dark case is a filter
        // over the finished page (see above).
        ...(pageColors?.background && !pageColors.foreground
            ? { background: pageColors.background }
            : {}),
    })
    const abortRaster = () => task.cancel()
    signal?.addEventListener('abort', abortRaster, { once: true })
    try {
        await task.promise
    } catch (error) {
        if (signal?.aborted
        || error instanceof Error && error.name === 'RenderingCancelledException') {
            throw new RenderCancelledError()
        }
        throw error
    } finally {
        signal?.removeEventListener('abort', abortRaster)
    }
    // The cover thumbnail reuses this canvas, so hand it over before the remap
    // — a cover should look like the book.
    onRendered?.(canvas)
    applyPageColors(canvasContext, canvas, pageColors)
    throwIfAborted()
    const canvasContainer = doc.querySelector('#canvas')
    const container = doc.querySelector<HTMLDivElement>('.textLayer')
    const annotationContainer = doc.querySelector<HTMLDivElement>('.annotationLayer')
    if (!canvasContainer || !container || !annotationContainer) throw new Error('PDF page template is incomplete')
    canvasContainer.replaceChildren(doc.adoptNode(canvas))

    // READAWARE: `TextLayer.render()` APPENDS. Every zoom/resize re-renders the
    // page, so without clearing first the spans stack up — text selects twice
    // over, and, worse, the DOM shape a stored CFI was measured against stops
    // being reproducible. Rebuilding from empty keeps it deterministic.
    container.replaceChildren()
    annotationContainer.replaceChildren()
    const textLayer = new pdfjsLib.TextLayer({
        textContentSource: await page.streamTextContent(),
        container, viewport,
    })
    const abortText = () => textLayer.cancel()
    signal?.addEventListener('abort', abortText, { once: true })
    try {
        await textLayer.render()
    } catch (error) {
        if (signal?.aborted) throw new RenderCancelledError()
        throw error
    } finally {
        signal?.removeEventListener('abort', abortText)
    }

    // hide "offscreen" canvases appended to docuemnt when rendering text layer
    // https://github.com/mozilla/pdf.js/blob/642b9a5ae67ef642b9a8808fd9efd447e8c350e2/web/pdf_viewer.css#L51-L58
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('.hiddenCanvasElement'))
        Object.assign(canvas.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '0',
            height: '0',
            display: 'none',
        })

    // READAWARE: WebKit-grade text selection, ported from PDF.js's own
    // text_layer_builder (PR #17923) and adapted to one page per iframe
    // document. The previous class toggle "only works in Firefox" (its own
    // TODO said so): the text layer is sparse absolutely-positioned spans,
    // and WebKit's native selection stalls in the gaps — a drag that starts
    // slightly off a line selects nothing, extending across lines glitches.
    const endOfContent = document.createElement('div')
    endOfContent.className = 'endOfContent'
    container.append(endOfContent)
    bindSelectionFixes(doc, container, endOfContent)

    throwIfAborted()
    const linkService = {
        goToDestination: () => {},
        getDestinationHash: (dest: string | PDFDestination) => JSON.stringify(dest),
        addLinkAttributes: (link: HTMLAnchorElement, url: string) => { link.href = url },
    }
    await new pdfjsLib.AnnotationLayer({ page, viewport, div: annotationContainer, linkService })
        .render({ annotations: await page.getAnnotations() })
}

const renderPage = async (page: PDFPage, onRendered?: (canvas: HTMLCanvasElement) => void): Promise<PageSource> => {
    const viewport = page.getViewport({ scale: 1 })
    const src = URL.createObjectURL(new Blob([`
        <!DOCTYPE html>
        <html lang="en">
        <meta charset="utf-8">
        <meta name="viewport" content="width=${viewport.width}, height=${viewport.height}">
        <style>
        html, body {
            margin: 0;
            padding: 0;
        }
        /*
        https://github.com/mozilla/pdf.js/commit/bd05b255fabfc313b194bfe9a17ccded4d90fb5a
        */
        :root {
          --user-unit: 1;
          --total-scale-factor: calc(var(--scale-factor) * var(--user-unit));
          --scale-round-x: 1px;
          --scale-round-y: 1px;
        }
        ${textLayerBuilderCSS}
        ${annotationLayerBuilderCSS}
        </style>
        <div id="canvas"></div>
        <div class="textLayer"></div>
        <div class="annotationLayer"></div>
    `], { type: 'text/html' }))
    const onZoom: NonNullable<PageSource['onZoom']> = ({ doc, scale, pageColors, signal }) =>
        render(page, doc, scale, onRendered, pageColors, signal)
    return { src, onZoom }
}

export const makePDF = async (file: BookFile) => {
    const failure = Promise.withResolvers<never>()
    let loadingTask: LoadingTask | undefined
    const transport = new BookRangeTransport(file, error => {
        failure.reject(error)
        // PDF.js has no range-error callback. Destroying the task rejects its
        // pending worker requests rather than leaving the reader waiting forever.
        void loadingTask?.destroy().catch((error: unknown) => console.error(error))
    })
    loadingTask = pdfjsLib.getDocument({
        range: transport,
        // READAWARE: every range request is a disk read across the IPC bridge.
        // The defaults are built for HTTP: 64 KiB chunks and an eager
        // background fetch of the ENTIRE file "while idle" — for a 175 MB
        // scan that is ~2700 sequential bridge round-trips flooding the same
        // channel the visible page's render is trying to use, which is
        // exactly the "first page takes forever" starvation. Demand-driven
        // fetches only, in chunks big enough that one page's image costs a
        // couple of round-trips.
        disableAutoFetch: true,
        disableStream: true,
        rangeChunkSize: 1 << 20,
        cMapUrl: pdfjsPath('cmaps/'),
        standardFontDataUrl: pdfjsPath('standard_fonts/'),
        wasmUrl: pdfjsPath('wasm/'),
        isEvalSupported: false,
    })
    const pdf = await Promise.race([loadingTask.promise, failure.promise])
    let metadata: ReturnType<typeof getPDFMetadata>
    let toc: ReturnType<typeof makePDFTOCItem>[] | undefined
    try {
        const data = await pdf.getMetadata()
        metadata = getPDFMetadata(data.metadata, data.info)
        toc = (await pdf.getOutline())?.map(makePDFTOCItem)
    } catch (error) {
        await pdf.destroy()
        throw error
    }

    const cache = new Map<number, Promise<PageSource>>()
    const renderedCovers = new Map<number, Promise<Awaited<ReturnType<typeof thumbnailFromCanvas>> | null>>()
    const urls = new Set<string>()
    let destroyed = false
    const sections = Array.from({ length: pdf.numPages }, (_, i) => ({
        id: `page:${i + 1}`,
        load: async () => {
            if (destroyed) throw new Error('PDF document was closed')
            const cached = cache.get(i)
            if (cached) return cached
            const pending = pdf.getPage(i + 1).then(page => renderPage(page, canvas => {
                if (!destroyed && !renderedCovers.has(i))
                    renderedCovers.set(i, thumbnailFromCanvas(canvas).catch((error: unknown) => {
                        console.warn('Could not capture rendered PDF cover', error)
                        return null
                    }))
            })).then(page => {
                if (destroyed) {
                    URL.revokeObjectURL(page.src)
                    throw new Error('PDF document was closed')
                }
                urls.add(page.src)
                return page
            }).catch((error: unknown) => {
                cache.delete(i)
                throw error
            })
            cache.set(i, pending)
            return pending
        },
        getText: async () => extractPageText(await pdf.getPage(i + 1)),
        size: 1000,
    }))
    const splitTOCHref = async (href: string): Promise<[string, null] | null> => {
        const target = await resolvePDFHref(pdf, href)
        return target ? [sections[target.index].id, null] : null
    }
    const getCover = async () => {
        // The first visible page has already paid the decode cost. Reuse its
        // canvas when possible rather than decoding a large scan twice.
        for (let i = 0; i < COVER_SCAN_PAGES; i++) {
            const cached = await renderedCovers.get(i)
            if (cached?.meaningful) return cached.blob
        }

        const count = Math.min(pdf.numPages, COVER_SCAN_PAGES)
        const deadline = performance.now() + COVER_RENDER_BUDGET_MS
        for (let i = 1; i <= count; i++) {
            const rendered = await renderCoverPage(await pdf.getPage(i), deadline)
            if (rendered.meaningful) return rendered.blob
            if (rendered.timedOut) break
        }
        return null
    }
    return {
        metadata, toc, sections,
        rendition: { layout: 'pre-paginated' },
        isExternal: (uri: string) => /^\w+:/i.test(uri),
        resolveHref: (href: string) => resolvePDFHref(pdf, href),
        splitTOCHref,
        getTOCFragment: (doc: Document) => doc.documentElement,
        getCover,
        destroy: async () => {
            if (destroyed) return
            destroyed = true
            transport.abort()
            for (const url of urls) URL.revokeObjectURL(url)
            urls.clear()
            cache.clear()
            renderedCovers.clear()
            await pdf.destroy()
        },
    } satisfies Book
}
