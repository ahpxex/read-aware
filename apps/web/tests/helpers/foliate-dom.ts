import { JSDOM } from "jsdom";

/** DOM-only unit tests; rendering and platform behavior remain Tauri tests. */
export async function withDom<T>(run: (window: JSDOM["window"]) => T | Promise<T>): Promise<T> {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>");
  const values: Array<[string, unknown]> = [
    ["document", dom.window.document],
    ["Node", dom.window.Node],
    ["NodeFilter", dom.window.NodeFilter],
    ["Range", dom.window.Range],
    ["XMLSerializer", dom.window.XMLSerializer],
    ["DOMParser", dom.window.DOMParser],
  ];
  const previous = values.map(([name]) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  try {
    for (const [name, value] of values) Object.defineProperty(globalThis, name, { value, configurable: true });
    return await run(dom.window);
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    dom.window.close();
  }
}
