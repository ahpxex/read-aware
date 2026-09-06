import { anchorElement, anchorValue } from './navigation.js';
export class ViewMedia {
    book;
    overlay;
    #controller = new AbortController();
    #generation = 0;
    #active;
    constructor(book, navigate, contents) {
        this.book = book;
        this.overlay = book.getMediaOverlay?.();
        this.overlay?.addEventListener('highlight', event => {
            this.#clear();
            const generation = ++this.#generation;
            const item = event.detail;
            if (!item)
                return;
            void navigate(item.text).then(resolved => {
                if (!resolved || generation !== this.#generation)
                    return;
                const content = contents().find(content => content.index === resolved.index);
                if (!content)
                    return;
                const element = anchorElement(anchorValue(content.doc, resolved.anchor));
                if (!element)
                    return;
                const { activeClass, playbackActiveClass } = book.media ?? {};
                if (activeClass)
                    element.classList.add(activeClass);
                if (playbackActiveClass)
                    element.ownerDocument.documentElement.classList.add(playbackActiveClass);
                this.#active = new WeakRef(element);
            }).catch(error => console.error('Could not highlight media overlay', error));
        }, { signal: this.#controller.signal });
        this.overlay?.addEventListener('unhighlight', () => {
            this.#generation++;
            this.#clear();
        }, { signal: this.#controller.signal });
    }
    #clear() {
        const element = this.#active?.deref();
        this.#active = undefined;
        if (!element)
            return;
        const { activeClass, playbackActiveClass } = this.book.media ?? {};
        if (activeClass)
            element.classList.remove(activeClass);
        if (playbackActiveClass)
            element.ownerDocument.documentElement.classList.remove(playbackActiveClass);
    }
    destroy() {
        this.#generation++;
        this.overlay?.stop();
        this.#controller.abort();
        this.#clear();
    }
}
