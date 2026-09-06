import type { Book } from "../../foliate-js/src/book";
import type { View } from "../../foliate-js/src/view";
import { fb2Fixture } from "../fixtures/foliate-books";

type Modules = {
  view: typeof import("../../foliate-js/src/view");
  fixed: typeof import("../../foliate-js/src/fixed-layout");
  fb2: typeof import("../../foliate-js/src/fb2");
};
type Result = { name: string; passed: boolean; details?: string };

export async function runLayoutRegressions(modules: Modules): Promise<Result[]> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Run this suite inside Tauri");
  const results: Result[] = [];
  const check = async (name: string, run: () => Promise<void>) => {
    try { await run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, details: String(error) }); }
  };
  const equal = (actual: unknown, expected: unknown) => {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  };
  const waitFor = async (condition: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error("Timed out waiting for page layout");
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  };
  const mount = () => {
    const view = new modules.view.View();
    view.style.cssText = "display:block;position:fixed;left:0;top:0;width:900px;height:600px;opacity:0;pointer-events:none;z-index:-1";
    document.body.append(view);
    return view;
  };
  const dispose = (view: View) => { view.close(); view.remove(); };
  const page = (index: number) => URL.createObjectURL(new Blob([
    `<!doctype html><html><head></head><body><p>Fixed page ${index}</p></body></html>`,
  ], { type: "text/html" }));

  await check("FB2 loads native XHTML and preserves notes and CFI selections", async () => {
    const book = await modules.fb2.makeFB2(new Blob([fb2Fixture]));
    const view = mount();
    try {
      await view.open(book);
      await view.goTo(0);
      const doc: Document | undefined = view.renderer.getContents()[0]?.doc;
      if (!doc) throw new Error("FB2 chapter did not load");
      equal(doc.querySelector("em")?.textContent, "world");
      equal(doc.querySelector("img")?.getAttribute("alt"), "Cover image");
      const text = doc.querySelector("em")?.firstChild;
      if (!text) throw new Error("Missing selection text");
      const range = doc.createRange();
      range.selectNodeContents(text);
      const restored = view.resolveCFI(view.getCFI(0, range));
      equal(restored.anchor(doc).toString(), "world");
      await view.goTo("#note-one");
      equal(view.renderer.getContents()[0]?.index, 2);
    } finally { dispose(view); book.destroy(); }
  });

  await check("fixed pages keep book viewport, spreads, direction and continuous scrolling", async () => {
    const urls = [0, 1, 2, 3].map(page);
    const book: Book = {
      metadata: { language: "en" }, rendition: { layout: "pre-paginated", viewport: "width=600,height=800" },
      sections: urls.map((url, index) => ({ id: index, size: 1000, load: () => url })),
    };
    const view = mount();
    try {
      await view.open(book);
      const renderer = view.renderer;
      if (!(renderer instanceof modules.fixed.FixedLayout)) throw new Error("Wrong renderer");
      renderer.setLayout("paginated", 1);
      await view.goTo(0);
      equal(renderer.index, 0);
      const doc = renderer.getContents()[0]?.doc;
      if (!doc) throw new Error("Missing fixed page");
      equal(doc.defaultView?.innerWidth, 600);
      await view.next();
      equal(renderer.index, 1);
      await view.prev();
      equal(renderer.index, 0);
      renderer.setLayout("paginated", 2);
      await view.goTo(1);
      equal(renderer.getSpreadOf(book.sections[1])?.side, "left");
      equal(renderer.getSpreadOf(book.sections[2])?.side, "right");
      renderer.setLayout("scrolled", 1);
      await view.goTo(2);
      await waitFor(() => renderer.getContents().some(content => content.index === 2));
      equal(renderer.scrolled, true);
      if (renderer.start <= 0 || renderer.viewSize <= renderer.clientHeight) throw new Error("Stack has no scroll geometry");
      await view.prev();
      equal(renderer.index, 1);
      await view.next();
      equal(renderer.index, 2);
    } finally { dispose(view); urls.forEach(url => URL.revokeObjectURL(url)); }

    const rtlView = mount();
    const rtlUrls = [0, 1, 2].map(page);
    try {
      const rtlBook: Book = { ...book, dir: "rtl", sections: rtlUrls.map((url, index) => ({ id: index, size: 1000, load: () => url })) };
      await rtlView.open(rtlBook);
      const renderer = rtlView.renderer;
      if (!(renderer instanceof modules.fixed.FixedLayout)) throw new Error("Wrong renderer");
      equal(renderer.getSpreadOf(rtlBook.sections[0])?.side, "left");
      equal(renderer.getSpreadOf(rtlBook.sections[1])?.side, "right");
      await rtlView.goTo(0);
      await rtlView.goLeft();
      equal(renderer.index, 1);
    } finally { dispose(rtlView); rtlUrls.forEach(url => URL.revokeObjectURL(url)); }
  });

  await check("fixed lazy render redraws after palette changes", async () => {
    const url = page(0);
    const calls: string[] = [];
    const view = mount();
    try {
      const book: Book = {
        rendition: { layout: "pre-paginated", spread: "none", viewport: { width: 600, height: 800 } },
        sections: [{ id: 0, size: 1000, load: () => ({ src: url, onZoom: async ({ doc, scale, pageColors, signal }) => {
          if (signal?.aborted) throw new DOMException("Cancelled", "RenderCancelledError");
          calls.push(pageColors?.background ?? "authored");
          doc.body.style.background = pageColors?.background ?? "white";
          doc.body.style.width = `${600 * scale}px`;
        } }) }],
      };
      await view.open(book);
      const renderer = view.renderer;
      if (!(renderer instanceof modules.fixed.FixedLayout)) throw new Error("Wrong renderer");
      await view.goTo(0);
      await waitFor(() => calls.includes("authored"));
      renderer.setPageColors({ background: "#101010", foreground: "#eeeeee" });
      await waitFor(() => calls.includes("#101010"));
      const doc = renderer.getContents()[0]?.doc;
      equal(doc?.defaultView?.getComputedStyle(doc.body).backgroundColor, "rgb(16, 16, 16)");
    } finally { dispose(view); URL.revokeObjectURL(url); }
  });

  await check("destroyed fixed renderers cannot resurrect a late-loading spread", async () => {
    const url = page(0);
    const renderer = new modules.fixed.FixedLayout();
    renderer.style.cssText = "display:block;position:fixed;width:900px;height:600px;opacity:0;pointer-events:none;z-index:-1";
    document.body.append(renderer);
    let complete: (url: string) => void = () => { throw new Error("Load not started"); };
    const loading = new Promise<string>(resolve => { complete = resolve; });
    renderer.open({ rendition: { spread: "none", viewport: "width=600,height=800" },
      sections: [{ id: 0, size: 1000, load: () => loading }],
    });
    const pending = renderer.goTo({ index: 0 }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
    });
    try {
      await Promise.resolve();
      renderer.destroy();
      complete(url);
      await pending;
      equal(renderer.getContents().length, 0);
    } finally { renderer.destroy(); renderer.remove(); URL.revokeObjectURL(url); }
  });
  return results;
}
