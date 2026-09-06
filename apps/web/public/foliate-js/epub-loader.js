import { NS, MIME, isExternal, resolveURL } from './epub-dom.js';
class MissingResourceError extends Error {
}
// RegExp match records retain capture groups and offsets without the loosely
// typed variadic callback used by String.replace.
const replaceSeries = async (text, pattern, replace) => {
    const matches = pattern.global ? text.matchAll(pattern) : [pattern.exec(text)];
    let offset = 0, output = '';
    for (const match of matches) {
        if (!match)
            continue;
        output += text.slice(offset, match.index) + await replace(match);
        offset = match.index + match[0].length;
    }
    return output + text.slice(offset);
};
const pathRelative = (from, to) => {
    if (!from)
        return to;
    const a = from.replace(/\/$/, '').split('/'), b = to.replace(/\/$/, '').split('/');
    const index = (a.length > b.length ? a : b).findIndex((_, i) => a[i] !== b[i]);
    return index < 0 ? '' : [...Array(a.length - index).fill('..'), ...b.slice(index)].join('/');
};
const pathDirname = (path) => path.slice(0, path.lastIndexOf('/') + 1);
const regexEscape = (text) => text.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
const isDocumentType = (type) => type === MIME.XHTML || type === MIME.HTML || type === MIME.SVG;
export class Loader {
    archive;
    resources;
    #cache = new Map();
    #children = new Map();
    #refCount = new Map();
    #destroyed = false;
    eventTarget = new EventTarget();
    constructor(archive, resources) {
        this.archive = archive;
        this.resources = resources;
    }
    async createURL(href, data, type, parent) {
        const originalData = Promise.resolve(data).then(value => {
            if (value == null)
                throw new MissingResourceError(`Missing EPUB resource: ${href}`);
            return value;
        });
        // A listener can replace the promise; otherwise the awaited data below
        // still propagates this rejection to the caller.
        void originalData.catch(() => { });
        const detail = { name: href, type, data: originalData };
        Object.defineProperty(detail, 'name', { writable: false });
        this.eventTarget.dispatchEvent(new CustomEvent('data', { detail }));
        let transformed;
        try {
            transformed = await Promise.all([detail.data, detail.type]);
        }
        catch (error) {
            // A missing illustration must not hide the rest of the chapter.
            // Section loaders separately require their own document URL.
            if (!(error instanceof MissingResourceError))
                throw error;
            console.warn(error.message);
            return null;
        }
        const [newData, newType] = transformed;
        if (this.#destroyed)
            throw new Error('EPUB resources were closed');
        // Concurrent section loads share resources, including their ownership.
        const existing = this.#cache.get(href);
        if (existing) {
            this.#ref(href, parent);
            return existing;
        }
        const url = URL.createObjectURL(new Blob([newData], { type: newType }));
        this.#cache.set(href, url);
        this.#ref(href, parent);
        return url;
    }
    #ref(href, parent) {
        if (parent) {
            const children = this.#children.get(parent) ?? new Set();
            if (children.has(href))
                return;
            children.add(href);
            this.#children.set(parent, children);
        }
        this.#refCount.set(href, (this.#refCount.get(href) ?? 0) + 1);
    }
    #unref(href) {
        const previous = this.#refCount.get(href);
        if (previous == null)
            return;
        if (previous > 1) {
            this.#refCount.set(href, previous - 1);
            return;
        }
        const url = this.#cache.get(href);
        if (url)
            URL.revokeObjectURL(url);
        this.#cache.delete(href);
        this.#refCount.delete(href);
        const children = this.#children.get(href);
        this.#children.delete(href);
        if (children)
            for (const child of children)
                this.#unref(child);
    }
    async loadItem(item, parents = []) {
        if (!item)
            return null;
        if (this.#destroyed)
            throw new Error('EPUB resources were closed');
        const { href, mediaType } = item;
        // Cyclic imports must not start an unbounded resource expansion.
        if (parents.includes(href))
            return null;
        const isScript = MIME.JS.test(mediaType);
        const detail = { type: mediaType, isScript, allow: true };
        this.eventTarget.dispatchEvent(new CustomEvent('load', { detail }));
        if (!await detail.allow)
            return null;
        const parent = parents.at(-1);
        const cached = this.#cache.get(href);
        if (cached) {
            this.#ref(href, parent);
            return cached;
        }
        if (isScript || isDocumentType(mediaType) || mediaType === MIME.CSS)
            return this.#loadReplaced(item, parents);
        return this.createURL(href, Promise.resolve().then(() => this.archive.loadBlob(href)), mediaType, parent);
    }
    async #loadHref(href, base, parents) {
        if (!href || href.startsWith('#') || isExternal(href))
            return href;
        const path = resolveURL(href, base);
        const hashIndex = path.indexOf('#');
        const resource = hashIndex < 0 ? path : path.slice(0, hashIndex);
        const fragment = hashIndex < 0 ? '' : path.slice(hashIndex);
        const item = this.resources.manifest.find(item => item.href === resource);
        if (!item)
            return href;
        const url = await this.loadItem(item, [...parents, base]);
        return url ? url + fragment : '';
    }
    async #loadReplaced(item, parents) {
        const { href, mediaType } = item;
        const parent = parents.at(-1);
        let text;
        try {
            text = await this.archive.loadText(href);
        }
        catch (error) {
            // A data listener may replace a failed resource with its own data.
            return this.createURL(href, Promise.reject(error), mediaType, parent);
        }
        if (text == null)
            return this.createURL(href, text, mediaType, parent);
        if (isDocumentType(mediaType)) {
            let doc = new DOMParser().parseFromString(text, mediaType);
            let type = mediaType;
            if (mediaType === MIME.XHTML && (doc.querySelector('parsererror') || !doc.documentElement.namespaceURI)) {
                console.warn(doc.querySelector('parsererror')?.textContent ?? 'Invalid XHTML');
                type = MIME.HTML;
                doc = new DOMParser().parseFromString(text, type);
            }
            for (const node of Array.from(doc.childNodes)) {
                if (node.nodeType !== Node.PROCESSING_INSTRUCTION_NODE)
                    continue;
                const data = node.nodeValue ?? '';
                const replaced = await replaceSeries(data, /(?:^|\s*)(href\s*=\s*['"])([^'"]*)(['"])/i, async ([, a, url, b]) => `${a}${await this.#loadHref(url, href, parents)}${b}`);
                doc.replaceChild(doc.createProcessingInstruction(node.nodeName, replaced), node);
            }
            const replace = async (element, attribute) => {
                const value = element.getAttribute(attribute);
                if (value != null)
                    element.setAttribute(attribute, await this.#loadHref(value, href, parents));
            };
            for (const [selector, attribute] of [['link[href]', 'href'], ['[src]', 'src'],
                ['[poster]', 'poster'], ['object[data]', 'data']])
                for (const element of doc.querySelectorAll(selector))
                    await replace(element, attribute);
            for (const element of doc.querySelectorAll('[*|href]:not([href])')) {
                const value = element.getAttributeNS(NS.XLINK, 'href');
                if (value != null)
                    element.setAttributeNS(NS.XLINK, 'xlink:href', await this.#loadHref(value, href, parents));
            }
            for (const element of doc.querySelectorAll('[srcset]'))
                element.setAttribute('srcset', await replaceSeries(element.getAttribute('srcset') ?? '', /(\s*)(.+?)\s*((?:\s[\d.]+[wx])+\s*(?:,|$)|,\s+|$)/g, async ([, a, url, b]) => `${a}${await this.#loadHref(url, href, parents)}${b}`));
            for (const element of doc.querySelectorAll('style'))
                if (element.textContent)
                    element.textContent = await this.#replaceCSS(element.textContent, href, parents);
            for (const element of doc.querySelectorAll('[style]'))
                element.setAttribute('style', await this.#replaceCSS(element.getAttribute('style') ?? '', href, parents));
            return this.createURL(href, new XMLSerializer().serializeToString(doc), type, parent);
        }
        const result = mediaType === MIME.CSS ? await this.#replaceCSS(text, href, parents)
            : await this.#replaceString(text, href, parents);
        return this.createURL(href, result, mediaType, parent);
    }
    async #replaceCSS(text, href, parents) {
        const urls = await replaceSeries(text, /url\(\s*["']?([^'"\n]*?)\s*["']?\s*\)/gi, async ([, url]) => `url("${await this.#loadHref(url, href, parents)}")`);
        return replaceSeries(urls, /@import\s*["']([^"'\n]*?)["']/gi, async ([, url]) => `@import "${await this.#loadHref(url, href, parents)}"`);
    }
    async #replaceString(text, href, parents) {
        const assets = new Map();
        for (const asset of this.resources.manifest) {
            if (asset.href === href)
                continue;
            const relative = pathRelative(pathDirname(href), asset.href);
            const root = '/' + asset.href;
            for (const path of [relative, encodeURI(relative), root, encodeURI(root)])
                assets.set(path, asset);
        }
        if (!assets.size)
            return text;
        const pattern = new RegExp(Array.from(assets.keys(), regexEscape).join('|'), 'g');
        return replaceSeries(text, pattern, async ([match]) => await this.loadItem(assets.get(match), [...parents, href]) ?? '');
    }
    unloadItem(item) { this.#unref(item.href); }
    destroy() {
        this.#destroyed = true;
        for (const url of this.#cache.values())
            URL.revokeObjectURL(url);
        this.#cache.clear();
        this.#children.clear();
        this.#refCount.clear();
    }
}
