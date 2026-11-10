import type { Book } from "../../foliate-js/src/book";
import type { View } from "../../foliate-js/src/view";
import type { LoadDetail } from "../../foliate-js/src/renderer";

type Result = { name: string; passed: boolean; details?: string };

const FIT = "data-foliate-fit";

/**
 * What opening a section costs: the document is laid out for one fit pass and
 * reported once, and nothing about the surface it is laid out against moves
 * afterwards (a second layout of a long section is the whole cost again).
 */
export async function runOpenLayoutRegressions(ViewClass: typeof View): Promise<Result[]> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("Run inside foreground Tauri");
  const results: Result[] = [];
  const assert = (value: boolean, message: string) => {
    if (!value) throw new Error(message);
  };
  const frames = (count = 2) =>
    new Promise<void>((resolve) => {
      const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
      step(count);
    });
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const page = (body: string) =>
    URL.createObjectURL(new Blob([`<!doctype html><html><body>${body}</body></html>`], { type: "text/html" }));
  const prose = (paragraphs: number) =>
    Array.from({ length: paragraphs }, (_, index) => `<p>Paragraph ${index}. ${"Reading prose. ".repeat(30)}</p>`).join(
      "",
    );
  const mount = () => {
    const view = new ViewClass();
    view.style.cssText =
      "position:fixed;display:block;left:0;top:0;width:900px;height:700px;opacity:0;pointer-events:none;z-index:-1";
    document.body.append(view);
    return view;
  };
  const bookOf = (urls: string[]): Book => ({
    sections: urls.map((url, index) => ({ id: String(index), size: 1000, load: () => url })),
    toc: urls.map((_, index) => ({ href: String(index) })),
    resolveHref: (href) => ({ index: Number(href) }),
  });

  for (const flow of ["scrolled", "paginated"] as const) {
    const name = `${flow}: an opened section is fitted and reported once`;
    const view = mount();
    const urls = [
      page(`<h1>Short</h1><p>Opening page.</p>`),
      page(`<h1>Long</h1><pre><code id="wide">${"an unbroken line of code ".repeat(40)}</code></pre>${prose(120)}`),
    ];
    try {
      await view.open(bookOf(urls));
      const renderer = view.renderer;
      if (!renderer || !("setLayoutAttributes" in renderer)) throw new Error("Missing paginator");
      renderer.setLayoutAttributes({ flow, "max-inline-size": "600px", "max-column-count": "1" });
      renderer.setStyles("body {font:18px/28px serif !important}");
      await view.goTo(0);
      await frames();
      // Each fit pass clears its markers and sets them again: a marker that
      // appears where there was none is one pass.
      let fits = 0;
      let relocations = 0;
      const passes = (records: MutationRecord[]) =>
        records.filter((record) => (record.target as Element).id === "wide" && record.oldValue === null).length;
      const marks = new MutationObserver((records) => {
        fits += passes(records);
      });
      view.addEventListener(
        "load",
        (event) => {
          const { doc, index } = (event as CustomEvent<LoadDetail>).detail;
          if (index === 1)
            marks.observe(doc.body, {
              subtree: true,
              attributes: true,
              attributeFilter: [FIT],
              attributeOldValue: true,
            });
        },
        { once: true },
      );
      const count = () => relocations++;
      view.addEventListener("relocate", count);
      await view.goTo(1);
      await frames(3);
      await delay(300);
      view.removeEventListener("relocate", count);
      fits += passes(marks.takeRecords());
      marks.disconnect();
      const doc = renderer.getContents().find((content) => content.index === 1)?.doc;
      assert(
        doc?.getElementById("wide")?.getAttribute(FIT)?.split(" ").includes("pre") === true,
        "The wide line was not fitted at all",
      );
      assert(fits === 1, `The section was fitted ${fits} times`);
      assert(relocations === 1, `One navigation was reported ${relocations} times`);
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, details: String(error) });
    } finally {
      await view.close();
      view.remove();
      urls.forEach((url) => URL.revokeObjectURL(url));
    }
  }

  {
    const name = "scrolled: the surface a section is laid out against keeps its width";
    const view = mount();
    const urls = [page(`<h1>Short</h1><p>Shorter than the viewport.</p>`), page(`<h1>Long</h1>${prose(120)}`)];
    try {
      await view.open(bookOf(urls));
      const renderer = view.renderer;
      if (!renderer || !("suspendScroll" in renderer)) throw new Error("Missing paginator");
      renderer.setLayoutAttributes({ flow: "scrolled", "max-inline-size": "2000px" });
      renderer.setStyles("body {font:18px/28px serif !important}");
      const width = (index: number) =>
        renderer.getContents().find((content) => content.index === index)?.doc.defaultView?.innerWidth ?? -1;
      await view.goTo(0);
      await frames(3);
      const short = width(0);
      await view.goTo(1);
      await frames(3);
      const long = width(1);
      assert(short > 0 && short === long, `A section that overflows is laid out narrower: ${short} vs ${long}`);
      // Pausing the scroll layer hides its overflow, and with it the scrollbar's track.
      const resume = renderer.suspendScroll();
      await frames(3);
      const paused = width(1);
      resume();
      await frames(3);
      assert(paused === long && width(1) === long, `Pausing the scroll resized the section: ${long} → ${paused}`);
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, details: String(error) });
    } finally {
      await view.close();
      view.remove();
      urls.forEach((url) => URL.revokeObjectURL(url));
    }
  }
  return results;
}
