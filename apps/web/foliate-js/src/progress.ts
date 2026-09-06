import type { TOCItem } from './book.js'
export type { TOCItem } from './book.js'
export type ProgressSection = { size?: number; linear?: string | null }
type TOCGroup<Fragment> = {
    prev?: TOCItem
    items: Array<{ fragment: Fragment | undefined; item: TOCItem }>
}
type TOCOptions<Id, Fragment> = {
    toc: TOCItem[]
    ids: Id[]
    splitHref: (href: string) => [Id, Fragment?] | [] | null | Promise<[Id, Fragment?] | [] | null>
    getFragment: (doc: Document, fragment: Fragment | undefined) => Node | null | undefined
}

// assign a unique ID for each TOC item
const assignIDs = (toc: TOCItem[]): TOCItem[] => {
    let id = 0
    const assignID = (item: TOCItem): void => {
        item.id = id++
        if (item.subitems) for (const subitem of item.subitems) assignID(subitem)
    }
    for (const item of toc) assignID(item)
    return toc
}

const flatten = (items: TOCItem[]): TOCItem[] => items
    .map(item => item.subitems?.length
        ? [item, flatten(item.subitems)].flat()
        : item)
    .flat()

export class TOCProgress<Id = string | number, Fragment = string | number | null> {
    ids: Id[] | undefined
    map = new Map<Id, TOCGroup<Fragment> | undefined>()
    getFragment: TOCOptions<Id, Fragment>['getFragment'] | undefined

    async init({ toc, ids, splitHref, getFragment }: TOCOptions<Id, Fragment>): Promise<void> {
        assignIDs(toc)
        const items = flatten(toc)
        // READAWARE: resolve every entry in parallel — the serial loop paid
        // one (PDF: two) worker round-trips per entry, one entry at a time.
        // A failed entry drops out instead of failing the whole index.
        const splits = await Promise.all(items.map(item =>
            Promise.resolve()
                .then(() => splitHref(item?.href))
                .catch(error => { console.warn('Could not resolve TOC entry', error); return null })))
        const grouped = new Map<Id, TOCGroup<Fragment>>()
        for (const [i, item] of items.entries()) {
            const [id, fragment] = splits[i] ?? []
            if (id == null) continue
            const value = { fragment, item }
            const group = grouped.get(id)
            if (group) group.items.push(value)
            else grouped.set(id, { prev: items[i - 1], items: [value] })
        }
        const map = new Map<Id, TOCGroup<Fragment> | undefined>()
        for (const [i, id] of ids.entries()) {
            if (grouped.has(id)) map.set(id, grouped.get(id))
            else map.set(id, map.get(ids[i - 1]))
        }
        this.ids = ids
        this.map = map
        this.getFragment = getFragment
    }
    getProgress(index: number, range?: Range | null): TOCItem | null | undefined {
        if (!this.ids || !this.getFragment) return
        const id = this.ids[index]
        const obj = this.map.get(id)
        if (!obj) return null
        const { prev, items } = obj
        if (!items) return prev
        if (!range || items.length === 1 && !items[0].fragment) return items[0].item

        const doc = range.startContainer.ownerDocument
        if (!doc) return null
        for (const [i, { fragment }] of items.entries()) {
            const el = this.getFragment(doc, fragment)
            if (!el) continue
            if (range.comparePoint(el, 0) > 0)
                return (items[i - 1]?.item ?? prev)
        }
        return items[items.length - 1].item
    }
}

export class SectionProgress {
    readonly sizes: number[]
    readonly sizePerLoc: number
    readonly sizePerTimeUnit: number
    readonly sizeTotal: number
    readonly sectionFractions: number[]

    constructor(sections: ProgressSection[], sizePerLoc: number, sizePerTimeUnit: number) {
        this.sizes = sections.map(s => s.linear !== 'no' && (s.size ?? 0) > 0 ? s.size ?? 0 : 0)
        this.sizePerLoc = sizePerLoc
        this.sizePerTimeUnit = sizePerTimeUnit
        this.sizeTotal = this.sizes.reduce((a, b) => a + b, 0)
        this.sectionFractions = this.#getSectionFractions()
    }
    #getSectionFractions() {
        const { sizeTotal } = this
        const results = [0]
        let sum = 0
        for (const size of this.sizes) results.push(sizeTotal > 0 ? (sum += size) / sizeTotal : 0)
        return results
    }
    // get progress given index of and fractions within a section
    getProgress(index: number, fractionInSection = 0, pageFraction = 0) {
        const { sizes, sizePerLoc, sizePerTimeUnit, sizeTotal } = this
        const sizeInSection = sizes[index] ?? 0
        const sizeBefore = sizes.slice(0, index).reduce((a, b) => a + b, 0)
        const size = sizeBefore + fractionInSection * sizeInSection
        const nextSize = size + pageFraction * sizeInSection
        const remainingTotal = sizeTotal - size
        const remainingSection = (1 - fractionInSection) * sizeInSection
        return {
            fraction: sizeTotal > 0 ? nextSize / sizeTotal : 0,
            section: {
                current: index,
                total: sizes.length,
            },
            location: {
                current: Math.floor(size / sizePerLoc),
                next: Math.floor(nextSize / sizePerLoc),
                total: Math.ceil(sizeTotal / sizePerLoc),
            },
            time: {
                section: remainingSection / sizePerTimeUnit,
                total: remainingTotal / sizePerTimeUnit,
            },
        }
    }
    // the inverse of `getProgress`
    // get index of and fraction in section based on total fraction
    getSection(fraction: number): [number, number] {
        if (!this.sizes.length || this.sizeTotal <= 0) return [0, 0]
        if (fraction <= 0) return [0, 0]
        if (fraction >= 1) return [this.sizes.length - 1, 1]
        fraction = fraction + Number.EPSILON
        const { sizeTotal } = this
        let index = this.sectionFractions.findIndex(x => x > fraction) - 1
        if (index < 0) return [0, 0]
        while (!this.sizes[index]) index++
        const fractionInSection = (fraction - this.sectionFractions[index])
            / (this.sizes[index] / sizeTotal)
        return [index, fractionInSection]
    }
}
