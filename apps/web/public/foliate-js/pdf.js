const pdfjsPath = path => new URL(`vendor/pdfjs/${path}`, import.meta.url).toString()

import './vendor/pdfjs/pdf.mjs'
const pdfjsLib = globalThis.pdfjsLib
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsPath('pdf.worker.mjs')

const fetchText = async url => await (await fetch(url)).text()

// https://raw.githubusercontent.com/mozilla/pdf.js/refs/tags/v5.5.207/web/text_layer_builder.css
const textLayerBuilderCSS = await fetchText(pdfjsPath('text_layer_builder.css'))

// https://raw.githubusercontent.com/mozilla/pdf.js/refs/tags/v5.5.207/web/annotation_layer_builder.css
const annotationLayerBuilderCSS = await fetchText(pdfjsPath('annotation_layer_builder.css'))

const COVER_MAX_EDGE = 480
const COVER_SCAN_PAGES = 5
const COVER_RENDER_BUDGET_MS = 2500

const canvasToBlob = canvas => new Promise((resolve, reject) =>
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to render PDF cover')),
        'image/png'))

const thumbnailFromCanvas = async source => {
    const scale = Math.min(1, COVER_MAX_EDGE / Math.max(source.width, source.height))
    const canvas = document.createElement('canvas')
    canvas.height = Math.max(1, Math.round(source.height * scale))
    canvas.width = Math.max(1, Math.round(source.width * scale))
    const context = canvas.getContext('2d', { alpha: false })
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

const renderCoverPage = async (page, deadline) => {
    const natural = page.getViewport({ scale: 1 })
    const scale = Math.min(1, COVER_MAX_EDGE / Math.max(natural.width, natural.height))
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.height = Math.max(1, Math.round(viewport.height))
    canvas.width = Math.max(1, Math.round(viewport.width))
    const canvasContext = canvas.getContext('2d', { alpha: false })
    canvasContext.fillStyle = '#fff'
    canvasContext.fillRect(0, 0, canvas.width, canvas.height)
    const task = page.render({ canvasContext, viewport })
    const remaining = deadline - performance.now()
    if (remaining <= 0) return { blob: null, meaningful: false, timedOut: true }
    const timeout = setTimeout(() => task.cancel(), remaining)
    try {
        await task.promise
    } catch (error) {
        if (performance.now() >= deadline || error?.name === 'RenderingCancelledException')
            return { blob: null, meaningful: false, timedOut: true }
        throw error
    } finally {
        clearTimeout(timeout)
    }

    return thumbnailFromCanvas(canvas)
}

const extractPageText = async page => {
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
                if (typeof item?.str !== 'string') continue
                text += item.str
                text += item.hasEOL ? '\n' : ' '
            }
        }
    } finally {
        reader.releaseLock()
    }
    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

const render = async (page, doc, zoom, onRendered) => {
    const scale = zoom * devicePixelRatio
    doc.documentElement.style.transform = `scale(${1 / devicePixelRatio})`
    doc.documentElement.style.transformOrigin = 'top left'
    doc.documentElement.style.setProperty('--scale-factor', scale)
    const viewport = page.getViewport({ scale })

    // the canvas must be in the `PDFDocument`'s `ownerDocument`
    // (`globalThis.document` by default); that's where the fonts are loaded
    const canvas = document.createElement('canvas')
    canvas.height = viewport.height
    canvas.width = viewport.width
    const canvasContext = canvas.getContext('2d')
    await page.render({ canvasContext, viewport }).promise
    onRendered?.(canvas)
    doc.querySelector('#canvas').replaceChildren(doc.adoptNode(canvas))

    const container = doc.querySelector('.textLayer')
    const textLayer = new pdfjsLib.TextLayer({
        textContentSource: await page.streamTextContent(),
        container, viewport,
    })
    await textLayer.render()

    // hide "offscreen" canvases appended to docuemnt when rendering text layer
    // https://github.com/mozilla/pdf.js/blob/642b9a5ae67ef642b9a8808fd9efd447e8c350e2/web/pdf_viewer.css#L51-L58
    for (const canvas of document.querySelectorAll('.hiddenCanvasElement'))
        Object.assign(canvas.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '0',
            height: '0',
            display: 'none',
        })

    // fix text selection
    // https://github.com/mozilla/pdf.js/blob/642b9a5ae67ef642b9a8808fd9efd447e8c350e2/web/text_layer_builder.js#L105-L107
    const endOfContent = document.createElement('div')
    endOfContent.className = 'endOfContent'
    container.append(endOfContent)
    // TODO: this only works in Firefox; see https://github.com/mozilla/pdf.js/pull/17923
    container.onpointerdown = () => container.classList.add('selecting')
    container.onpointerup = () => container.classList.remove('selecting')

    const div = doc.querySelector('.annotationLayer')
    const linkService = {
        goToDestination: () => {},
        getDestinationHash: dest => JSON.stringify(dest),
        addLinkAttributes: (link, url) => link.href = url,
    }
    await new pdfjsLib.AnnotationLayer({ page, viewport, div, linkService })
        .render({ annotations: await page.getAnnotations() })
}

const renderPage = async (page, onRendered) => {
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
    const onZoom = ({ doc, scale }) => render(page, doc, scale, onRendered)
    return { src, onZoom }
}

const makeTOCItem = item => ({
    label: item.title,
    href: JSON.stringify(item.dest),
    subitems: item.items.length ? item.items.map(makeTOCItem) : null,
})

export const makePDF = async file => {
    const transport = new pdfjsLib.PDFDataRangeTransport(file.size, [])
    transport.requestDataRange = (begin, end) => {
        file.slice(begin, end).arrayBuffer().then(chunk => {
            transport.onDataRange(begin, chunk)
        })
    }
    const pdf = await pdfjsLib.getDocument({
        range: transport,
        cMapUrl: pdfjsPath('cmaps/'),
        standardFontDataUrl: pdfjsPath('standard_fonts/'),
        wasmUrl: pdfjsPath('wasm/'),
        isEvalSupported: false,
    }).promise

    const book = { rendition: { layout: 'pre-paginated' } }

    const { metadata, info } = await pdf.getMetadata() ?? {}
    // TODO: for better results, parse `metadata.getRaw()`
    book.metadata = {
        title: metadata?.get('dc:title') ?? info?.Title,
        author: metadata?.get('dc:creator') ?? info?.Author,
        contributor: metadata?.get('dc:contributor'),
        description: metadata?.get('dc:description') ?? info?.Subject,
        language: metadata?.get('dc:language'),
        publisher: metadata?.get('dc:publisher'),
        subject: metadata?.get('dc:subject'),
        identifier: metadata?.get('dc:identifier'),
        source: metadata?.get('dc:source'),
        rights: metadata?.get('dc:rights'),
    }

    const outline = await pdf.getOutline()
    book.toc = outline?.map(makeTOCItem)

    const cache = new Map()
    const renderedCovers = new Map()
    book.sections = Array.from({ length: pdf.numPages }).map((_, i) => ({
        id: `page:${i + 1}`,
        load: async () => {
            const cached = cache.get(i)
            if (cached) return cached
            const url = await renderPage(await pdf.getPage(i + 1), canvas => {
                if (!renderedCovers.has(i))
                    renderedCovers.set(i, thumbnailFromCanvas(canvas).catch(() => null))
            })
            cache.set(i, url)
            return url
        },
        getText: async () => extractPageText(await pdf.getPage(i + 1)),
        size: 1000,
    }))
    book.isExternal = uri => /^\w+:/i.test(uri)
    book.resolveHref = async href => {
        const parsed = JSON.parse(href)
        const dest = typeof parsed === 'string'
            ? await pdf.getDestination(parsed) : parsed
        const index = await pdf.getPageIndex(dest[0])
        return { index }
    }
    book.splitTOCHref = async href => {
        const parsed = JSON.parse(href)
        const dest = typeof parsed === 'string'
            ? await pdf.getDestination(parsed) : parsed
        const index = await pdf.getPageIndex(dest[0])
        return [index, null]
    }
    book.getTOCFragment = doc => doc.documentElement
    book.getCover = async () => {
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
    book.destroy = () => pdf.destroy()
    return book
}
