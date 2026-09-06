export class History extends EventTarget {
    #arr = [];
    #index = -1;
    pushState(state) {
        const last = this.#arr[this.#index];
        if (last === state || typeof last === 'object' && typeof state === 'object'
            && 'fraction' in last && 'fraction' in state && last.fraction === state.fraction)
            return;
        this.#arr[++this.#index] = state;
        this.#arr.length = this.#index + 1;
        this.dispatchEvent(new Event('index-change'));
    }
    replaceState(state) {
        if (this.#index < 0)
            this.pushState(state);
        else
            this.#arr[this.#index] = state;
    }
    #move(index) {
        if (index < 0 || index >= this.#arr.length)
            return;
        this.#index = index;
        this.dispatchEvent(new CustomEvent('popstate', { detail: { state: this.#arr[index] } }));
        this.dispatchEvent(new Event('index-change'));
    }
    back() { this.#move(this.#index - 1); }
    forward() { this.#move(this.#index + 1); }
    get canGoBack() { return this.#index > 0; }
    get canGoForward() { return this.#index < this.#arr.length - 1; }
    clear() {
        this.#arr = [];
        this.#index = -1;
        this.dispatchEvent(new Event('index-change'));
    }
}
