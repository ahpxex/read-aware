const size = (element: HTMLElement) => ({ width: element.clientWidth, height: element.clientHeight });

/** Lays the content out again as soon as its box changes size, in the
 * observer callback itself: a window drag reflows in the same frame. The
 * render keeps the context the content had (its last positioning cause). */
export class RendererResizeObserver {
  #observer: ResizeObserver;
  #element: HTMLElement | undefined;
  #size: { width: number; height: number } | undefined;
  constructor(context: () => object | undefined, render: (context?: object) => void) {
    this.#observer = new ResizeObserver(() => {
      const element = this.#element,
        before = this.#size;
      if (!element || !before) return;
      const next = size(element);
      if (next.width === before.width && next.height === before.height) return;
      this.#size = next;
      render(context());
    });
  }
  observe(element: HTMLElement) {
    this.disconnect();
    this.#element = element;
    this.#size = size(element);
    this.#observer.observe(element);
  }
  disconnect() {
    this.#element = undefined;
    this.#size = undefined;
    this.#observer.disconnect();
  }
}
