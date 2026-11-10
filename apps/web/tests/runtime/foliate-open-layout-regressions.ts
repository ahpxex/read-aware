import type { Book } from "../../foliate-js/src/book";
import type { View } from "../../foliate-js/src/view";
import type { LoadDetail } from "../../foliate-js/src/renderer";

type Result = { name: string; passed: boolean; details?: string };

const FIT = "data-foliate-fit";

const DEFER = "data-foliate-defer";

/**
 * What opening a section costs: the document is laid out for one fit pass and
 * reported once, and nothing about the surface it is laid out against moves
 * afterwards (a second layout of a long section is the whole cost again).
 *
 * A long section is laid out around the place it is opened at and completed
 * while the reader is idle. Until then the reader must not be able to tell:
 * what is on screen is what a whole layout shows and stays where it is, the
 * laid-out edge is not the section's edge, and every place can be reached.
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
      page(`<h1>Long</h1><pre><code id="wide">${"an unbroken line of code ".repeat(40)}</code></pre>${prose(12)}`),
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
      const relocations: (string | null | undefined)[] = [];
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
      const count = (event: Event) =>
        relocations.push((event as CustomEvent<{ reason?: string | null }>).detail.reason);
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
      assert(relocations.join() === "navigation", `One navigation was reported as: ${relocations.join()}`);
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
  {
    // A chapter opening with a picture that loads after the page is shown,
    // continued in the next source file: the continuation joins while the
    // picture is still nothing, and the picture then pushes the text down.
    const name = "scrolled: a picture that loads late leaves a chapter open at its start";
    const view = mount();
    const picture = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="gray"/></svg>')}`;
    const urls = [
      page(`<h1>Before</h1>${prose(8)}`),
      page(`<img id="plate" alt=""><p id="caption">The caption under the plate.</p>`),
      page(`<p>The chapter goes on in the next file.</p>${prose(8)}`),
    ];
    try {
      const book = bookOf(urls);
      // One chapter over the last two files.
      book.toc = [{ href: "0" }, { href: "1" }];
      await view.open(book);
      const renderer = view.renderer;
      if (!renderer || !("setChapterStarts" in renderer)) throw new Error("Missing paginator");
      renderer.setChapterStarts(
        new Map([
          [0, [{ index: 0 }]],
          [1, [{ index: 1 }]],
        ]),
      );
      renderer.setLayoutAttributes({ flow: "scrolled", "max-inline-size": "600px" });
      renderer.setStyles("body {font:18px/28px serif !important} img {display:block}");
      await view.goTo(0);
      await view.goTo(1);
      await renderer.whenChapterSettled();
      await frames(3);
      assert(renderer.getContents().length === 2, "The chapter's continuation did not join");
      const doc = renderer.getContents().find((content) => content.index === 1)!.doc;
      const plate = doc.getElementById("plate") as HTMLImageElement;
      await new Promise<void>((resolve, reject) => {
        plate.addEventListener("load", () => resolve(), { once: true });
        plate.addEventListener("error", () => reject(new Error("The plate did not load")), { once: true });
        plate.src = picture;
      });
      await frames(4);
      assert(plate.getBoundingClientRect().height > 300, "The plate has no size");
      assert(
        renderer.start < 1,
        `The chapter's start was scrolled ${renderer.start}px off the screen when its picture arrived`,
      );
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, details: String(error) });
    } finally {
      await view.close();
      view.remove();
      urls.forEach((url) => URL.revokeObjectURL(url));
    }
  }

  // ---- a long section: laid out around the reader, completed while idle ----

  const numbered = (from: number, to: number) =>
    Array.from(
      { length: to - from },
      (_, offset) =>
        `<p id="p${from + offset}">Paragraph ${from + offset}. ${"Long section prose. ".repeat(8 + ((from + offset) % 5) * 4)}</p>`,
    ).join("");
  const longSection = () =>
    page(
      `<h1 id="c1">Chapter one</h1>${numbered(0, 200)}<ol id="list">${Array.from({ length: 60 }, (_, index) => `<li>Item ${index}</li>`).join("")}</ol><h1 id="c2">Chapter two</h1>${numbered(200, 400)}<h1 id="c3">Chapter three</h1>${numbered(400, 600)}`,
    );
  const at = (id: string) => ({ index: 1, anchor: (doc: Document) => doc.getElementById(id) });
  const screenTop = (element: Element) =>
    element.getBoundingClientRect().top +
    (element.ownerDocument.defaultView?.frameElement?.getBoundingClientRect().top ?? 0);
  const visible = (view: View) => view.lastLocation?.range?.toString().trim().replace(/\s+/g, " ") ?? "";
  const open = async (flow: "scrolled" | "paginated", urls: string[]) => {
    const view = mount();
    await view.open(bookOf(urls));
    const renderer = view.renderer;
    if (!renderer || !("whenLaidOut" in renderer)) throw new Error("Missing paginator");
    renderer.setLayoutAttributes({ flow, "max-inline-size": "600px", "max-column-count": "1" });
    renderer.setStyles("body {font:18px/28px serif !important} p {margin:0 0 14px}");
    const doc = () => renderer.getContents().find((content) => content.index === 1)!.doc;
    const deferred = () => doc().querySelectorAll(`[${DEFER}]`).length;
    return { view, renderer, doc, deferred };
  };
  const close = async (...views: View[]) => {
    for (const view of views) {
      await view.close();
      view.remove();
    }
  };

  for (const flow of ["scrolled", "paginated"] as const) {
    const urls = [page(`<h1>Short</h1><p>Opening page.</p>`), longSection()];
    // A scrolled target is at the top of the viewport; a page holds it wherever its column begins.
    const shows = (view: View, text: string) =>
      flow === "scrolled" ? visible(view).startsWith(text) : visible(view).includes(text);
    const run = async (name: string, test: () => Promise<void>) => {
      try {
        await test();
        results.push({ name: `${flow}: ${name}`, passed: true });
      } catch (error) {
        results.push({ name: `${flow}: ${name}`, passed: false, details: String(error) });
      }
    };

    await run("a long section opens on its target, laid out around it", async () => {
      const windowed = await open(flow, urls);
      // A fraction addresses the laid-out extent, so this one is laid out whole.
      const whole = await open(flow, urls);
      try {
        await whole.view.goTo({ index: 1, anchor: 0.5 });
        assert(whole.deferred() === 0, "A fraction was resolved against part of the section");
        await whole.view.goTo(at("p300"));
        const relocations: (string | null | undefined)[] = [];
        windowed.view.addEventListener("relocate", (event) =>
          relocations.push((event as CustomEvent<{ reason?: string | null }>).detail.reason),
        );
        await windowed.view.goTo(at("p300"));
        const waiting = windowed.deferred();
        // Columns need every page before the target; scrolled flow only what is around it.
        assert(
          waiting > (flow === "paginated" ? 200 : 500),
          `The section was laid out nearly whole to open it: ${waiting} blocks deferred`,
        );
        assert(
          windowed.doc().querySelectorAll(`#list [${DEFER}], #list[${DEFER}] li[${DEFER}]`).length === 0,
          "A list was cut",
        );
        assert(shows(windowed.view, "Paragraph 300."), `Opened on: ${visible(windowed.view).slice(0, 40)}`);
        assert(visible(windowed.view) === visible(whole.view), "The opening page differs from a whole layout's");
        if (flow === "paginated")
          assert(
            windowed.renderer.page === whole.renderer.page,
            "The opening page is not the page a whole layout puts it on",
          );
        const target = windowed.doc().getElementById("p300")!;
        const before = screenTop(target);
        await windowed.renderer.whenLaidOut();
        await frames(3);
        assert(windowed.deferred() === 0, "The section was not completed");
        assert(
          Math.abs(screenTop(target) - before) < 1,
          `Completing the section moved the page by ${screenTop(target) - before}px`,
        );
        for (const id of ["p0", "p150", "list", "p300", "p450", "p599"]) {
          const a = windowed.doc().getElementById(id)!.getBoundingClientRect();
          const b = whole.doc().getElementById(id)!.getBoundingClientRect();
          assert(
            Math.abs(a.top - b.top) < 1 && Math.abs(a.left - b.left) < 1 && Math.abs(a.height - b.height) < 1,
            `#${id} is laid out at ${a.left},${a.top} (${a.height}) instead of ${b.left},${b.top} (${b.height})`,
          );
        }
        assert(
          Math.abs(windowed.renderer.viewSize - whole.renderer.viewSize) < 1,
          "The completed section has another extent than a whole layout",
        );
        assert(
          Math.abs((windowed.view.lastLocation?.fraction ?? -1) - (whole.view.lastLocation?.fraction ?? -2)) < 1e-6,
          `Progress was left an estimate: ${windowed.view.lastLocation?.fraction} vs ${whole.view.lastLocation?.fraction}`,
        );
        assert(
          relocations.join() === "navigation,anchor",
          `Opening and completing were reported as: ${relocations.join()}`,
        );
      } finally {
        await close(windowed.view, whole.view);
      }
    });

    await run("reading on from the laid-out part shows what a whole layout shows", async () => {
      const windowed = await open(flow, urls);
      const whole = await open(flow, urls);
      try {
        await whole.view.goTo({ index: 1, anchor: 0.5 });
        await whole.view.goTo(at("c2"));
        await windowed.view.goTo(at("c2"));
        assert(windowed.deferred() > 300, "The section was laid out whole");
        assert(!windowed.renderer.atEnd, "The laid-out edge is taken for the end of the book");
        if (flow === "scrolled")
          assert(windowed.renderer.hasPendingContent(1), "The laid-out edge is taken for the end of the chapter");
        // Turn pages at once, faster than the idle completion: each must be the whole layout's page.
        for (let turn = 0; turn < 24; turn++) {
          await windowed.renderer.next();
          await whole.renderer.next();
          assert(
            windowed.view.lastLocation?.section.current === 1,
            `Turn ${turn} left the section at the edge of what was laid out`,
          );
          const shown = visible(windowed.view),
            expected = visible(whole.view);
          assert(
            shown === expected,
            `Turn ${turn} shows "${shown.slice(0, 30)} … ${shown.slice(-30)}" (${shown.length}) instead of "${expected.slice(0, 30)} … ${expected.slice(-30)}" (${expected.length})`,
          );
        }
      } finally {
        await close(windowed.view, whole.view);
      }
    });

    await run("a place that is not laid out yet can be gone to", async () => {
      const windowed = await open(flow, urls);
      try {
        await windowed.view.goTo(at("p20"));
        assert(windowed.deferred() > 300, "The section was laid out whole");
        assert(windowed.doc().getElementById("p570")!.hasAttribute(DEFER), "The far target is laid out already");
        await windowed.view.goTo(at("p570"));
        assert(shows(windowed.view, "Paragraph 570."), `Went to: ${visible(windowed.view).slice(0, 40)}`);
        await windowed.view.goTo(at("p20"));
        assert(shows(windowed.view, "Paragraph 20."), `Went back to: ${visible(windowed.view).slice(0, 40)}`);
        // The section's end, entered from the next section.
        await windowed.view.goTo(0);
        await windowed.view.goTo({ index: 1, anchor: 1 });
        const shown = windowed.view.lastLocation?.range;
        assert(
          !!shown && windowed.doc().getElementById("p599")!.contains(shown.endContainer),
          `The section's end shows: ${visible(windowed.view).slice(-60)}`,
        );
      } finally {
        await close(windowed.view);
      }
    });
  }

  {
    const name = "scrolled: scrolling back into content that is not laid out yet keeps the text in place";
    const urls = [page(`<h1>Short</h1><p>Opening page.</p>`), longSection()];
    const windowed = await open("scrolled", urls);
    try {
      await windowed.view.goTo(at("p300"));
      assert(windowed.doc().getElementById("p250")!.hasAttribute(DEFER), "Nothing before the target is deferred");
      const scroller = (() => {
        let element: Element | null = windowed.doc().defaultView!.frameElement;
        while (element && getComputedStyle(element).overflowY !== "scroll") element = element.parentElement;
        return element as HTMLElement;
      })();
      const target = windowed.doc().getElementById("p300")!;
      for (let step = 0; step < 6; step++) {
        const before = screenTop(target);
        const from = scroller.scrollTop;
        scroller.scrollTop = Math.max(0, from - 400);
        const scrolled = from - scroller.scrollTop;
        await frames(3);
        const moved = screenTop(target) - before;
        assert(
          Math.abs(moved - scrolled) < 1.5,
          `Scrolling up ${scrolled}px moved the text ${moved}px (step ${step}; from ${from} to ${scroller.scrollTop}, ${windowed.deferred()} deferred)`,
        );
        if (scrolled < 400) {
          // The top of what was laid out: more must have joined above it by now.
          assert(
            windowed.renderer.hasPendingContent(-1) || windowed.deferred() === 0 || scroller.scrollTop > 0,
            "Stuck at the laid-out edge",
          );
        }
      }
      assert(!windowed.doc().getElementById("p292")!.hasAttribute(DEFER), "Content above the viewport never joined");
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, details: String(error) });
    } finally {
      await close(windowed.view);
    }
  }
  return results;
}
