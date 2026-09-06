import type { Book } from "../../foliate-js/src/book";
import type { Paginator } from "../../foliate-js/src/paginator";

type Result = { name: string; passed: boolean; details?: string };

export async function runPaginatorRegressions(PaginatorClass: typeof Paginator): Promise<Result[]> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Run this suite inside Tauri");
  const results: Result[] = [];
  const check = async (name: string, run: () => Promise<void>) => {
    try { await run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, details: String(error) }); }
  };
  const equal = (actual: unknown, expected: unknown) => {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  };
  const mount = () => {
    const renderer = new PaginatorClass();
    renderer.style.cssText = "display:block;position:fixed;left:0;top:0;width:900px;height:600px;opacity:0;pointer-events:none;z-index:-1";
    document.body.append(renderer);
    return renderer;
  };
  const page = (text: string, style = "") => URL.createObjectURL(new Blob([
    `<!doctype html><html><head><style>${style}</style></head><body><p>${text}</p></body></html>`,
  ], { type: "text/html" }));
  const dispose = (renderer: Paginator, urls: string[]) => {
    renderer.destroy(); renderer.remove(); urls.forEach(url => URL.revokeObjectURL(url));
  };

  await check("page boundaries skip non-linear sections and remain usable after a failed load", async () => {
    const urls = ["First", "Footnote", "Last"].map(text => page(text));
    let fail = true;
    const unloaded: number[] = [];
    const book: Book = { sections: urls.map((url, index) => ({ id: index, size: 10,
      linear: index === 1 ? "no" : "yes", load: async () => {
        if (index === 2 && fail) throw new Error("Expected fixture read failure");
        return url;
      }, unload: () => { unloaded.push(index); },
    })) };
    const renderer = mount();
    try {
      renderer.open(book);
      await renderer.goTo({ index: 0 });
      await renderer.prev();
      equal(renderer.getContents()[0]?.index, 0);
      let rejected = false;
      try { await renderer.next(); } catch { rejected = true; }
      equal(rejected, true);
      equal(renderer.getContents()[0]?.index, 0);
      fail = false;
      await renderer.next();
      equal(renderer.getContents()[0]?.index, 2);
      equal(unloaded.includes(0), true);
      await renderer.next();
      equal(renderer.getContents()[0]?.index, 2);
      await renderer.prev();
      equal(renderer.getContents()[0]?.index, 0);
    } finally { dispose(renderer, urls); }
  });

  await check("a newer navigation wins over a late section load", async () => {
    const urls = ["Slow", "Current"].map(text => page(text));
    let complete: (url: string) => void = () => { throw new Error("Load not started"); };
    const loading = new Promise<string>(resolve => { complete = resolve; });
    const renderer = mount();
    let released = 0;
    try {
      renderer.open({ sections: [{ id: 0, size: 10, load: () => loading, unload: () => { released++; } }, { id: 1, size: 10, load: () => urls[1] }] });
      const first = renderer.goTo({ index: 0 });
      await Promise.resolve();
      await renderer.goTo({ index: 1 });
      complete(urls[0]);
      await first;
      equal(renderer.getContents()[0]?.index, 1);
      equal(renderer.getContents()[0]?.doc.querySelector("p")?.textContent, "Current");
      equal(released, 1);
    } finally { dispose(renderer, urls); }
  });

  await check("closing a paginator cancels late work and is safe before first navigation", async () => {
    const empty = mount();
    dispose(empty, []);
    const url = page("Late");
    let complete: (url: string) => void = () => { throw new Error("Load not started"); };
    const loading = new Promise<string>(resolve => { complete = resolve; });
    const renderer = mount();
    try {
      renderer.open({ sections: [{ id: 0, size: 10, load: () => loading }] });
      const pending = renderer.goTo({ index: 0 });
      await Promise.resolve();
      renderer.destroy();
      complete(url);
      await pending;
      equal(renderer.getContents().length, 0);
    } finally { dispose(renderer, [url]); }
  });

  await check("scrolled images have finite limits and vertical/RTL pages retain readable geometry", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 2000;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Missing fixture canvas");
    context.fillStyle = "red";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const imageSource = canvas.toDataURL();
    const image = page(`<img alt="test" src="${imageSource}">`);
    const vertical = page("纵向排版测试。".repeat(250), "body { writing-mode: vertical-rl; line-height: 2; }");
    const rtl = page("نص عربي للقراءة ".repeat(250), "body {direction:rtl;line-height:2}");
    const renderer = mount();
    try {
      renderer.open({ sections: [image, vertical, rtl].map((url, index) => ({ id: index, size: 1000, load: () => url })) });
      renderer.setAttribute("flow", "scrolled");
      await renderer.goTo({ index: 0 });
      const img = renderer.getContents()[0]?.doc.querySelector("img");
      if (!img) throw new Error("Missing image");
      equal(img.naturalWidth, 1000);
      const maxHeight = parseFloat(img.style.maxHeight);
      if (!Number.isFinite(maxHeight) || maxHeight <= 0) throw new Error(`Invalid image limit: ${img.style.maxHeight}`);
      renderer.setAttribute("flow", "paginated");
      await renderer.goTo({ index: 1 });
      equal(renderer.sideProp, "height");
      equal(renderer.scrollProp, "scrollTop");
      if (!Number.isFinite(renderer.pages) || renderer.pages <= 2) throw new Error("Vertical content did not paginate");
      await renderer.goTo({ index: 2 });
      equal(renderer.getAttribute("dir"), "rtl");
      equal(renderer.scrollProp, "scrollLeft");
      if (!Number.isFinite(renderer.start)) throw new Error("Invalid RTL geometry");
    } finally { dispose(renderer, [image, vertical, rtl]); }
  });
  return results;
}
