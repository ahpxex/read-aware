type CursorState = { x?: number; y?: number; hidden?: boolean }

export class CursorAutohider {
    #timeout: ReturnType<typeof setTimeout> | undefined
    #controller = new AbortController()
    constructor(private readonly el: HTMLElement, private readonly check: () => boolean,
        private readonly state: CursorState = {}) {
        if (state.hidden) this.hide()
        el.addEventListener('mousemove', ({ screenX, screenY }) => {
            if (screenX === state.x && screenY === state.y) return
            state.x = screenX
            state.y = screenY
            this.show()
            clearTimeout(this.#timeout)
            if (check()) this.#timeout = setTimeout(() => this.hide(), 1000)
        }, { signal: this.#controller.signal })
    }
    cloneFor(el: HTMLElement) { return new CursorAutohider(el, this.check, this.state) }
    hide() { this.el.style.cursor = 'none'; this.state.hidden = true }
    show() { this.el.style.removeProperty('cursor'); this.state.hidden = false }
    destroy() {
        this.#controller.abort()
        clearTimeout(this.#timeout)
        this.show()
    }
}
