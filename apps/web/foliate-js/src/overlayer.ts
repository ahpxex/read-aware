export type DrawOptions = {
    color?: string
    width?: number
    writingMode?: string
    radius?: number
    src?: string
}

export type DrawFunction = (rects: Iterable<DOMRect>, options: DrawOptions) => SVGElement
type Overlay = {
    range: Range
    draw: DrawFunction
    options: DrawOptions
    element: SVGElement
    rects: DOMRectList
    hitValue: string
}

const createSVGElement = (tag: string): SVGElement =>
    document.createElementNS('http://www.w3.org/2000/svg', tag)

export class Overlayer {
    #svg = createSVGElement('svg')
    #map = new Map<string, Overlay>()
    constructor() {
        Object.assign(this.#svg.style, {
            position: 'absolute', top: '0', left: '0',
            width: '100%', height: '100%',
            pointerEvents: 'none',
        })
    }
    get element() {
        return this.#svg
    }
    add(key: string, range: Range | ((root: Node) => Range), draw: DrawFunction, options: DrawOptions, hitValue = key) {
        if (this.#map.has(key)) this.remove(key)
        if (typeof range === 'function') range = range(this.#svg.getRootNode())
        const rects = range.getClientRects()
        const element = draw(rects, options)
        this.#svg.append(element)
        this.#map.set(key, { range, draw, options, element, rects, hitValue })
    }
    remove(key: string) {
        const overlay = this.#map.get(key)
        if (!overlay) return
        this.#svg.removeChild(overlay.element)
        this.#map.delete(key)
    }
    redraw() {
        for (const obj of this.#map.values()) {
            const { range, draw, options, element } = obj
            this.#svg.removeChild(element)
            const rects = range.getClientRects()
            const el = draw(rects, options)
            this.#svg.append(el)
            obj.element = el
            obj.rects = rects
        }
    }
    hitTest({ x, y }: { x: number; y: number }): [string, Range] | [] {
        const arr = Array.from(this.#map.entries())
        // loop in reverse to hit more recently added items first
        for (let i = arr.length - 1; i >= 0; i--) {
            const [, obj] = arr[i]
            for (const { left, top, right, bottom } of obj.rects)
                if (top <= y && left <= x && bottom > y && right > x)
                    return [obj.hitValue, obj.range]
        }
        return []
    }
    static underline(rects: Iterable<DOMRect>, options: DrawOptions = {}) {
        const { color = 'red', width: strokeWidth = 2, writingMode } = options
        const g = createSVGElement('g')
        g.setAttribute('fill', color)
        if (writingMode === 'vertical-rl' || writingMode === 'vertical-lr')
            for (const { right, top, height } of rects) {
                const el = createSVGElement('rect')
                el.setAttribute('x', String(right - strokeWidth))
                el.setAttribute('y', String(top))
                el.setAttribute('height', String(height))
                el.setAttribute('width', String(strokeWidth))
                g.append(el)
            }
        else for (const { left, bottom, width } of rects) {
            const el = createSVGElement('rect')
            el.setAttribute('x', String(left))
            el.setAttribute('y', String(bottom - strokeWidth))
            el.setAttribute('height', String(strokeWidth))
            el.setAttribute('width', String(width))
            g.append(el)
        }
        return g
    }
    static strikethrough(rects: Iterable<DOMRect>, options: DrawOptions = {}) {
        const { color = 'red', width: strokeWidth = 2, writingMode } = options
        const g = createSVGElement('g')
        g.setAttribute('fill', color)
        if (writingMode === 'vertical-rl' || writingMode === 'vertical-lr')
            for (const { right, left, top, height } of rects) {
                const el = createSVGElement('rect')
                el.setAttribute('x', String((right + left) / 2))
                el.setAttribute('y', String(top))
                el.setAttribute('height', String(height))
                el.setAttribute('width', String(strokeWidth))
                g.append(el)
            }
        else for (const { left, top, bottom, width } of rects) {
            const el = createSVGElement('rect')
            el.setAttribute('x', String(left))
            el.setAttribute('y', String((top + bottom) / 2))
            el.setAttribute('height', String(strokeWidth))
            el.setAttribute('width', String(width))
            g.append(el)
        }
        return g
    }
    static squiggly(rects: Iterable<DOMRect>, options: DrawOptions = {}) {
        const { color = 'red', width: strokeWidth = 2, writingMode } = options
        const g = createSVGElement('g')
        g.setAttribute('fill', 'none')
        g.setAttribute('stroke', color)
        g.setAttribute('stroke-width', String(strokeWidth))
        const block = strokeWidth * 1.5
        if (writingMode === 'vertical-rl' || writingMode === 'vertical-lr')
            for (const { right, top, height } of rects) {
                const el = createSVGElement('path')
                const n = Math.round(height / block / 1.5)
                const inline = height / n
                const ls = Array.from({ length: n },
                    (_, i) => `l${i % 2 ? -block : block} ${inline}`).join('')
                el.setAttribute('d', `M${right} ${top}${ls}`)
                g.append(el)
            }
        else for (const { left, bottom, width } of rects) {
            const el = createSVGElement('path')
            const n = Math.round(width / block / 1.5)
            const inline = width / n
            const ls = Array.from({ length: n },
                (_, i) => `l${inline} ${i % 2 ? block : -block}`).join('')
            el.setAttribute('d', `M${left} ${bottom}${ls}`)
            g.append(el)
        }
        return g
    }
    static highlight(rects: Iterable<DOMRect>, options: DrawOptions = {}) {
        const { color = 'red' } = options
        const g = createSVGElement('g')
        g.setAttribute('fill', color)
        g.style.opacity = 'var(--overlayer-highlight-opacity, .3)'
        g.style.mixBlendMode = 'var(--overlayer-highlight-blend-mode, normal)'
        for (const { left, top, height, width } of rects) {
            const el = createSVGElement('rect')
            el.setAttribute('x', String(left))
            el.setAttribute('y', String(top))
            el.setAttribute('height', String(height))
            el.setAttribute('width', String(width))
            g.append(el)
        }
        return g
    }
    static outline(rects: Iterable<DOMRect>, options: DrawOptions = {}) {
        const { color = 'red', width: strokeWidth = 3, radius = 3 } = options
        const g = createSVGElement('g')
        g.setAttribute('fill', 'none')
        g.setAttribute('stroke', color)
        g.setAttribute('stroke-width', String(strokeWidth))
        for (const { left, top, height, width } of rects) {
            const el = createSVGElement('rect')
            el.setAttribute('x', String(left))
            el.setAttribute('y', String(top))
            el.setAttribute('height', String(height))
            el.setAttribute('width', String(width))
            el.setAttribute('rx', String(radius))
            g.append(el)
        }
        return g
    }
    // make an exact copy of an image in the overlay
    // one can then apply filters to the entire element, without affecting them;
    // it's a bit silly and probably better to just invert images twice
    // (though the color will be off in that case if you do heu-rotate)
    static copyImage([rect]: Iterable<DOMRect>, options: DrawOptions = {}) {
        const { src = '' } = options
        if (!rect) throw new Error('Cannot copy an image without its rectangle')
        const image = createSVGElement('image')
        const { left, top, height, width } = rect
        image.setAttribute('href', src)
        image.setAttribute('x', String(left))
        image.setAttribute('y', String(top))
        image.setAttribute('height', String(height))
        image.setAttribute('width', String(width))
        return image
    }
}
