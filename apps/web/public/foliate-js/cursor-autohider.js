export class CursorAutohider {
    el;
    check;
    state;
    #timeout;
    #controller = new AbortController();
    constructor(el, check, state = {}) {
        this.el = el;
        this.check = check;
        this.state = state;
        if (state.hidden)
            this.hide();
        el.addEventListener('mousemove', ({ screenX, screenY }) => {
            if (screenX === state.x && screenY === state.y)
                return;
            state.x = screenX;
            state.y = screenY;
            this.show();
            clearTimeout(this.#timeout);
            if (check())
                this.#timeout = setTimeout(() => this.hide(), 1000);
        }, { signal: this.#controller.signal });
    }
    cloneFor(el) { return new CursorAutohider(el, this.check, this.state); }
    hide() { this.el.style.cursor = 'none'; this.state.hidden = true; }
    show() { this.el.style.removeProperty('cursor'); this.state.hidden = false; }
    destroy() {
        this.#controller.abort();
        clearTimeout(this.#timeout);
        this.show();
    }
}
