import type { TOCItem } from './book.js'
import { NS, childGetter, getElementText } from './epub-dom.js'

export const parseNav = (doc: Document, resolve: (href: string) => string = href => href) => {
    const { $, $$, $$$ } = childGetter(doc, NS.XHTML)
    const parseList = (list: Element | undefined, getType = false): TOCItem[] | null =>
        list ? $$(list, 'li').map(li => {
            const link = $(li, 'a') ?? $(li, 'span')
            const href = link?.getAttribute('href')
            const type = getType ? link?.getAttributeNS(NS.EPUB, 'type')?.split(/\s+/) : undefined
            return {
                label: getElementText(link) || link?.getAttribute('title') || undefined,
                href: href ? decodeURI(resolve(href)) : null,
                subitems: parseList($(li, 'ol'), getType), ...(type ? { type } : {}),
            }
        }) : null
    let toc: TOCItem[] | null = null
    let pageList: TOCItem[] | null = null
    let landmarks: TOCItem[] | null = null
    const others: Array<{ label: string; type: string[]; list: TOCItem[] | null }> = []
    for (const nav of $$$(doc, 'nav')) {
        const type = nav.getAttributeNS(NS.EPUB, 'type')?.split(/\s+/) ?? []
        if (type.includes('toc')) toc ??= parseList($(nav, 'ol'))
        else if (type.includes('page-list')) pageList ??= parseList($(nav, 'ol'))
        else if (type.includes('landmarks')) landmarks ??= parseList($(nav, 'ol'), true)
        else others.push({ label: getElementText(nav.firstElementChild), type, list: parseList($(nav, 'ol')) })
    }
    return { toc, pageList, landmarks, others }
}

export const parseNCX = (doc: Document, resolve: (href: string) => string = href => href) => {
    const { $, $$ } = childGetter(doc, NS.NCX)
    const parseItem = (el: Element): TOCItem => {
        const href = $(el, 'content')?.getAttribute('src')
        const children = el.localName === 'navPoint' ? $$(el, 'navPoint') : []
        return { label: getElementText($(el, 'navLabel')),
            href: href ? decodeURI(resolve(href)) : null,
            ...(children.length ? { subitems: children.map(parseItem) } : {}),
        }
    }
    const getList = (container: string, item: string) => {
        const el = $(doc.documentElement, container)
        return el ? $$(el, item).map(parseItem) : null
    }
    return {
        toc: getList('navMap', 'navPoint'), pageList: getList('pageList', 'pageTarget'),
        others: $$(doc.documentElement, 'navList').map(el => ({
            label: getElementText($(el, 'navLabel')), list: $$(el, 'navTarget').map(parseItem),
        })),
    }
}

export const getHTMLFragment = (doc: Document, id: string) => doc.getElementById(id)
    ?? doc.querySelector(`[name="${CSS.escape(id)}"]`)

export const getPageSpread = (properties: string[]) => {
    for (const property of properties) {
        if (property === 'page-spread-left' || property === 'rendition:page-spread-left') return 'left'
        if (property === 'page-spread-right' || property === 'rendition:page-spread-right') return 'right'
        if (property === 'rendition:page-spread-center') return 'center'
    }
}

export const getDisplayOptions = (doc: Document | null) => doc ? {
    fixedLayout: getElementText(doc.querySelector('option[name="fixed-layout"]')),
    openToSpread: getElementText(doc.querySelector('option[name="open-to-spread"]')),
} : null
