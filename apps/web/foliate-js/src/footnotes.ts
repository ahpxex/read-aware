import type { Book, ResolvedNavigation } from './book.js'
import { View, type LinkDetail } from './view.js'
import type { LoadDetail } from './renderer.js'
import { anchorElement, anchorValue, isRange } from './navigation.js'

const getTypes = (el: Element | null) => new Set(el?.getAttributeNS('http://www.idpf.org/2007/ops', 'type')?.split(/\s+/))
const getRoles = (el: Element | null) => new Set(el?.getAttribute('role')?.split(/\s+/))
const isSuper = (el: Element | null): boolean => {
    if (!el) return false
    if (el.matches('sup')) return true
    const verticalAlign = el.ownerDocument.defaultView?.getComputedStyle(el).verticalAlign ?? ''
    return ['super', 'top', 'text-top'].includes(verticalAlign) || /^\d/.test(verticalAlign)
}
const refTypes = ['biblioref', 'glossref', 'noteref']
const refRoles = ['doc-biblioref', 'doc-glossref', 'doc-noteref']
export const isFootnoteReference = (a: Element) => {
    const types = getTypes(a), roles = getRoles(a)
    return {
        yes: refRoles.some(role => roles.has(role)) || refTypes.some(type => types.has(type)),
        maybe: () => !types.has('backlink') && !roles.has('doc-backlink')
            && (isSuper(a) || a.children.length === 1 && isSuper(a.children[0]) || isSuper(a.parentElement)),
    }
}
export type FootnoteType = 'biblioentry' | 'definition' | 'endnote' | 'footnote' | 'note'
export const getReferencedType = (el: Element | null): FootnoteType | null => {
    const types = getTypes(el), roles = getRoles(el)
    return roles.has('doc-biblioentry') || types.has('biblioentry') ? 'biblioentry'
        : roles.has('definition') || types.has('glossdef') ? 'definition'
        : roles.has('doc-endnote') || types.has('endnote') || types.has('rearnote') ? 'endnote'
        : roles.has('doc-footnote') || types.has('footnote') ? 'footnote'
        : roles.has('note') || types.has('note') ? 'note' : null
}
const inline = 'a, span, sup, sub, em, strong, i, b, small, big'
export const extractFootnote = (doc: Document, anchor: ResolvedNavigation['anchor']): Element => {
    let el = anchorElement(anchorValue(doc, anchor))
    if (!el) throw new Error('Footnote has no document anchor')
    const target = el
    while (el.matches(inline) && el.parentElement) el = el.parentElement
    if (el === doc.body) {
        const sibling = target.nextElementSibling
        if (sibling && !sibling.matches(inline)) return sibling
        throw new Error('Failed to extract footnote')
    }
    return el
}
export type FootnoteBeforeRenderDetail = { view: View }
export type FootnoteRenderDetail = {
    view: View
    href: string
    type: FootnoteType | null
    hidden: boolean
    target: Element | null
}

export class FootnoteHandler extends EventTarget {
    detectFootnotes = true
    async #showFragment(book: Book, { index, anchor }: ResolvedNavigation, href: string): Promise<void> {
        if (!book.sections[index]) throw new Error('Footnote section is missing')
        const view = new View()
        try {
            await view.open(book)
            this.dispatchEvent(new CustomEvent<FootnoteBeforeRenderDetail>('before-render', { detail: { view } }))
            await new Promise<void>((resolve, reject) => {
                view.addEventListener('load', event => {
                    try {
                        const { doc } = (event as CustomEvent<LoadDetail>).detail
                        const value = anchorValue(doc, anchor)
                        const target = anchorElement(value)
                        if (!value || typeof value === 'number') throw new Error('Footnote target is missing')
                        const type = getReferencedType(target)
                        const hidden = !!target?.matches('aside') && type === 'footnote'
                        const range = isRange(value) ? value : doc.createRange()
                        if (!isRange(value)) {
                            if (value.matches('li, aside')) range.selectNodeContents(value)
                            else range.selectNode(value)
                        }
                        doc.body.replaceChildren(range.extractContents())
                        this.dispatchEvent(new CustomEvent<FootnoteRenderDetail>('render',
                            { detail: { view, href, type, hidden, target } }))
                        resolve()
                    } catch (error) { reject(error) }
                }, { once: true })
                void view.goTo(index).then(result => {
                    if (!result) reject(new Error('Footnote navigation was cancelled'))
                }, reject)
            })
        } catch (error) {
            await view.close()
            view.remove()
            throw error
        }
    }
    handle(book: Book, event: CustomEvent<LinkDetail>): Promise<void> | undefined {
        const { a, href } = event.detail
        const { yes, maybe } = isFootnoteReference(a)
        if (!yes && !(this.detectFootnotes && maybe())) return
        event.preventDefault()
        return Promise.resolve(book.resolveHref?.(href)).then(target => {
            if (!target) throw new Error('Could not resolve footnote: ' + href)
            return this.#showFragment(book, yes ? target
                : { index: target.index, anchor: doc => extractFootnote(doc, target.anchor) }, href)
        })
    }
}
